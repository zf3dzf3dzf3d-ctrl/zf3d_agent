/**
 * background.js - 画布背景管理器
 * 模式：color(纯色，默认) / image(图片)，星空已融合进背景样式
 * 特效独立叠加，默认关闭（none）
 * 配置持久化：localStorage zf_background + UserSettings 兼容
 */
var Background = {
    mode: 'color',          // color | image
    color: '#0d1117',
    scheme: null,           // 默认方案：墨夜 grad-inkblue（init 时设置）
    imageUrl: '',
    imageBlur: true,
    imageDark: true,
    fxs: ['grid'],      // 网格（默认特效，多选数组 v5.4.6）

    _fxTimers: [],
    _fxCleanups: [],
    _fxSubs: [],
    _fxLayer: null,
    _parallaxRAF: null,

    // ===== 初始化 =====
    init: function () {
        var self = this;
        this._buildLayer();
        // 首次无存储时默认方案：墨夜
        if (!this.scheme) {
            for (var k = 0; k < this.schemes.length; k++) {
                if (this.schemes[k].id === 'solid-ink') { this.scheme = this.schemes[k]; break; }
            }
        }
        this.apply();
        this._setupUI();
        // 异步从服务器加载已保存的背景配置，到达后覆盖当前默认值
        this._loadFromServer(function (saved) {
            if (saved) {
                self.mode = 'color'; // v30: 图片模式已移除
                self.color = saved.color || '#0d1117';
                // v5.4.6: fx→fxs 数组化，兼容旧单值存档
                if (Array.isArray(saved.fxs)) self.fxs = saved.fxs.slice(0, 3);
                else self.fxs = [saved.fx || 'grid'];
                if (self.fxs.indexOf('none') >= 0) self.fxs = [];
                if (saved.schemeId) {
                    var found = null;
                    for (var i = 0; i < Background.schemes.length; i++) {
                        if (Background.schemes[i].id === saved.schemeId) { found = Background.schemes[i]; break; }
                    }
                    self.scheme = found;
                } else {
                    // 默认方案：墨夜
                    for (var i = 0; i < Background.schemes.length; i++) {
                        if (Background.schemes[i].id === 'solid-ink') { self.scheme = Background.schemes[i]; break; }
                    }
                }
                self.imageUrl = saved.imageUrl || '';
                self.imageBlur = saved.imageBlur !== false;
                self.imageDark = saved.imageDark !== false;
            }
            self.apply();
        });
    },

    // ===== 持久化（独立接口 /api/background → private/用户设置/background.json，不混入主设置） =====
    save: function () {
        try {
            var data = JSON.stringify({
                mode: this.mode,
                color: this.color,
                schemeId: this.scheme ? this.scheme.id : null,
                imageUrl: this.imageUrl,
                imageBlur: this.imageBlur,
                imageDark: this.imageDark,
                fxs: this.fxs,
                fx: (this.fxs && this.fxs[0]) || ''
            });
            localStorage.setItem('zf_background', data); // 本地缓存，秒开
            fetch('/api/background', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ background: JSON.parse(data) })
            }).catch(function () {});
        } catch (e) {}
    },

    _load: function () {
        return null; // 改为异步加载，见 _loadFromServer
    },

    _loadFromServer: function (cb) {
        var self = this;
        fetch('/api/background')
            .then(function (r) { return r.json(); })
            .then(function (res) {
                if (res && res.ok && res.background && Object.keys(res.background).length) {
                    cb(res.background);
                    return;
                }
                // 服务器无配置时，回退 localStorage（升级兼容），并回写服务器
                try {
                    var s = localStorage.getItem('zf_background');
                    if (s) {
                        var obj = JSON.parse(s);
                        cb(obj);
                        self.save();
                        return;
                    }
                } catch (e) {}
                cb(null);
            })
            .catch(function () {
                // 服务器不可用时回退 localStorage
                try {
                    var s = localStorage.getItem('zf_background');
                    cb(s ? JSON.parse(s) : null);
                } catch (e) { cb(null); }
            });
    },

    // ===== 背景层 DOM =====
    _buildLayer: function () {
        if (document.getElementById('bgCustomLayer')) return;
        var canvasArea = document.getElementById('canvasArea');
        if (!canvasArea) return;
        var layer = document.createElement('div');
        layer.id = 'bgCustomLayer';
        layer.className = 'bg-custom-layer';
        var fxLayer = document.createElement('div');
        fxLayer.id = 'bgFxLayer';
        fxLayer.className = 'bg-fx-layer';
        canvasArea.insertBefore(fxLayer, canvasArea.firstChild);
        canvasArea.insertBefore(layer, fxLayer);
        this._fxLayer = fxLayer;
    },

    // ===== 鼠标视差浮动：让特效层随鼠标微微移动 =====
    _setupParallax: function () {
        var self = this;
        if (self._parallaxBound) return;
        self._parallaxBound = true;
        var target = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
        var AMPLITUDE = 14; // 最大偏移像素
        document.addEventListener('mousemove', function (e) {
            target.x = (e.clientX / window.innerWidth - 0.5) * 2;   // -1 ~ 1
            target.y = (e.clientY / window.innerHeight - 0.5) * 2;
        }, { passive: true });
        function tick() {
            cur.x += (target.x - cur.x) * 0.06; // 缓动，柔和跟随
            cur.y += (target.y - cur.y) * 0.06;
            var layer = self._fxLayer || document.getElementById('bgFxLayer');
            if (layer) {
                layer.style.transform = 'translate3d(' + (-cur.x * AMPLITUDE).toFixed(2) + 'px,' + (-cur.y * AMPLITUDE).toFixed(2) + 'px,0) scale(1.05)'; // scale 补偿，防止平移后露边
            }
            self._parallaxRAF = requestAnimationFrame(tick);
        }
        tick();
    },

    // ===== 应用背景 =====
    // 拖拽取色时的轻量应用：只更新背景色和面板 CSS 变量，不触发 save/特效重建/UI 全量刷新
    _applyColorLive: function () {
        if (this.mode !== 'color') return;
        var layer = document.getElementById('bgCustomLayer');
        var body = document.body;
        var m = /^#?([0-9a-f]{6})$/i.exec(this.color || '');
        var rgb = m ? { r: parseInt(m[1].slice(0, 2), 16), g: parseInt(m[1].slice(2, 4), 16), b: parseInt(m[1].slice(4, 6), 16) } : null;
        var dark = (rgb ? (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000 : 0) < 128;
        var c = rgb || { r: 16, g: 22, b: 33 };
        if (layer) layer.style.background = this.color;
        body.style.setProperty('--kite-panel-bg', 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',.92)');
        body.style.setProperty('--kite-panel-border', dark ? 'rgba(255,255,255,.22)' : 'rgba(0,0,0,.25)');
        body.style.setProperty('--kite-panel-text', dark ? '#dfeeff' : '#1c2330');
    },

    // ===== 背景方案（渐变，用户点选） =====
    schemes: [
        // ---- 纯色 10（黑 → 灰 → 白/亮，按亮度升序）----
        { id: 'solid-ink',    name: '墨夜',   css: '#0d1117', accent: '#1c2530' },
        { id: 'slate',        name: '深空灰', css: '#1c2530', accent: '#2c3a4d' },
        { id: 'navy',         name: '藏蓝',   css: '#12263f', accent: '#1f4470' },
        { id: 'wine',         name: '酒红',   css: '#4a1f27', accent: '#7a3242' },
        { id: 'pine',         name: '松绿',   css: '#1f4536', accent: '#2f6b52' },
        { id: 'tealgray',     name: '青灰',   css: '#2d4a53', accent: '#3f6b78' },
        { id: 'amber',        name: '琥珀',   css: '#7a4a12', accent: '#b0741f' },
        { id: 'violet',       name: '亮紫',   css: '#8b5cf6', accent: '#a78bfa' },
        { id: 'skyblue',      name: '天蓝',   css: '#2d7dd2', accent: '#5aa3e8' },
        { id: 'lake',         name: '湖绿',   css: '#17a398', accent: '#3cc9be' },
        // ---- 渐变 10（按起始色亮度升序）----
        { id: 'grad-graphite', name: '曜石灰', css: 'linear-gradient(to top,#121418,#23262e)', accent: '#3a3f4c' },
        { id: 'grad-inkblue',  name: '墨蓝',   css: 'linear-gradient(to top,#0c1626,#1c2f4a)', accent: '#34517e' },
        { id: 'grad-wine',     name: '酒红夜', css: 'linear-gradient(to top,#241018,#542437)', accent: '#a04a66' },
        { id: 'grad-plum',     name: '紫夜',   css: 'linear-gradient(to top,#1a1230,#3b2a63)', accent: '#6d4fc4' },
        { id: 'grad-forest',   name: '深林',   css: 'linear-gradient(to top,#0d1f18,#1d4030)', accent: '#2f6b52' },
        { id: 'grad-dawn',     name: '曙光橙', css: 'linear-gradient(to top,#2b1a10,#8a5a24)', accent: '#d99a3e' },
        { id: 'grad-rainbow',  name: '彩虹晨', css: 'linear-gradient(to top,#251540,#7c3aed,#e879a0)', accent: '#a855f7' },
        { id: 'grad-sakura',   name: '樱粉',   css: 'linear-gradient(to top,#3a1a2e,#c4789e)', accent: '#e39ac0' },
        { id: 'grad-steel',    name: '苍青',   css: 'linear-gradient(to top,#123038,#2b6e70)', accent: '#4aa0a2' },
        { id: 'grad-bluesky',  name: '青空',   css: 'linear-gradient(to top,#163a5e,#4a9bd8)', accent: '#6fb6e8' },
        // ---- 灰色 + 颜色渐变 5 ----
        { id: 'grad-greyblue',  name: '灰蓝',   css: 'linear-gradient(to top,#2a2d33,#3f5a78)', accent: '#5b82ab' },
        { id: 'grad-greypurple',name: '灰紫',   css: 'linear-gradient(to top,#2c2a33,#5a4a78)', accent: '#7d68a8' },
        { id: 'grad-greygreen', name: '灰绿',   css: 'linear-gradient(to top,#2a2f2c,#3f6b58)', accent: '#5a9478' },
        { id: 'grad-greyrose',  name: '灰粉',   css: 'linear-gradient(to top,#332a2e,#784a5e)', accent: '#a86b84' },
        { id: 'grad-greyamber', name: '灰金',   css: 'linear-gradient(to top,#2f2c26,#6e5a2f)', accent: '#a8894a' },
        // ---- 白色 + 颜色渐变 5 ----
        { id: 'grad-whiteblue', name: '白云蓝', css: 'linear-gradient(to top,#e8eef5,#6fa8dc)', accent: '#4a86c8' },
        { id: 'grad-whitepurple',name:'白云紫', css: 'linear-gradient(to top,#f0ebf5,#a87fd0)', accent: '#8a5fc0' },
        { id: 'grad-whitegreen',name: '白青绿', css: 'linear-gradient(to top,#eaf5ee,#5fbf8a)', accent: '#3a9e68' },
        { id: 'grad-whiterose', name: '白樱粉', css: 'linear-gradient(to top,#f5eef0,#e08fae)', accent: '#c86a90' },
        { id: 'grad-whiteamber',name: '白琥珀', css: 'linear-gradient(to top,#f5f0e5,#e0b45f)', accent: '#c8963a' },
    ],

    _applySchemeStyle: function () {
        var layer = document.getElementById('bgCustomLayer');
        if (!layer) return;
        var body = document.body;
        body.style.removeProperty('--kite-panel-bg');
        body.style.removeProperty('--kite-panel-border');
        body.style.removeProperty('--kite-panel-text');
        layer.style.display = 'block';
        layer.style.backgroundImage = 'none';
        layer.style.background = this.scheme.css || this.color;
        body.style.setProperty('--kite-panel-bg', 'rgba(10,14,26,.82)');
        body.style.setProperty('--kite-panel-border', 'rgba(255,255,255,.18)');
        body.style.setProperty('--kite-panel-text', '#e6ecf7');
    },

    apply: function () {
        var layer = document.getElementById('bgCustomLayer');
        var body = document.body;
        if (!layer) return;

        // ===== 用户自定义背景标记：供白天主题补丁等样式跟随自定义背景色 =====
        var customBg = this.color || '';
        if (this.mode === 'color' && !this.scheme && /^#?[0-9a-f]{6}$/i.test(customBg)) {
            var _m = /^#?([0-9a-f]{6})$/i.exec(customBg);
            var _r = parseInt(_m[1].slice(0,2),16), _g = parseInt(_m[1].slice(2,4),16), _b = parseInt(_m[1].slice(4,6),16);
            var _dark = (_r*299 + _g*587 + _b*114) / 1000 < 128;
            body.classList.add('zf-has-custom-bg');
            body.style.setProperty('--zf-custom-bg', customBg);
            body.style.setProperty('--zf-custom-text', _dark ? '#e6ecf7' : '#1a1a1a');
        } else {
            body.classList.remove('zf-has-custom-bg');
        }

        // ===== 风筝统计面板跟随背景颜色 =====
        function _hexToRgb(hex) {
            var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
            if (!m) return null;
            return { r: parseInt(m[1].slice(0,2),16), g: parseInt(m[1].slice(2,4),16), b: parseInt(m[1].slice(4,6),16) };
        }
        function _luma(c) { return c ? (c.r*299 + c.g*587 + c.b*114) / 1000 : null; }
        if (this.mode === 'color' && this.scheme) { this._applySchemeStyle(); } else if (this.mode === 'color' && this.color) {
            var rgb = _hexToRgb(this.color);
            var dark = (rgb ? _luma(rgb) : 0) < 128;
            var c = rgb || { r:16, g:22, b:33 };
            body.style.setProperty('--kite-panel-bg', 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',.92)');
            body.style.setProperty('--kite-panel-border', dark ? 'rgba(255,255,255,.22)' : 'rgba(0,0,0,.25)');
            body.style.setProperty('--kite-panel-text', dark ? '#dfeeff' : '#1c2330');
        } else {
            // 默认星空 / 图片背景：还原默认样式
            body.style.removeProperty('--kite-panel-bg');
            body.style.removeProperty('--kite-panel-border');
            body.style.removeProperty('--kite-panel-text');
        }

        // 先清理
        layer.style.background = '';
        layer.style.display = 'none';
        body.classList.remove('bg-star-off', 'bg-image-blur', 'bg-image-dark');

        if (this.mode === 'image' && this.imageUrl) {
            layer.style.display = 'block';
            layer.style.backgroundImage = 'url("' + this.imageUrl.replace(/"/g, '\\"') + '")';
            layer.style.backgroundSize = 'cover';
            layer.style.backgroundPosition = 'center';
            body.classList.toggle('bg-image-blur', this.imageBlur);
            body.classList.toggle('bg-image-dark', this.imageDark);
        } else {
            // 纯色 / 渐变方案
            layer.style.display = 'block';
            layer.style.background = (this.scheme && this.scheme.css) ? this.scheme.css : this.color;
        }
        // 特效为独立叠加层，默认关闭；星空 canvas 常驻跟随背景样式
        var star = document.getElementById('starfield');
        if (star) star.style.display = '';

        this._applyFx();
        this._updateUI();
    },

    // ===== 特效（v5.4.6 多选：每个 fx 一个 .bg-fx-sub 子层）=====
    _applyFx: function () {
        var self = this;
        var fxLayer = this._fxLayer || document.getElementById('bgFxLayer');
        if (!fxLayer) return;
        self._setupParallax();
        fxLayer.className = 'bg-fx-layer';
        // 清理全部子层 / 计时器 / canvas
        this._fxTimers.forEach(function (t) { clearInterval(t); });
        this._fxTimers = [];
        this._fxCleanups.forEach(function (c) { try { c(); } catch (e) {} });
        this._fxCleanups = [];
        fxLayer.innerHTML = '';
        this._fxSubs = [];

        var fxs = (Array.isArray(this.fxs) ? this.fxs : (this.fxs ? [this.fxs] : []));
        if (fxs.indexOf('none') >= 0) fxs = [];
        fxs.slice(0, 3).forEach(function (fx) {
            var sub = document.createElement('div');
            sub.className = 'bg-fx-sub';
            sub.setAttribute('data-fx', fx);
            fxLayer.appendChild(sub);
            self._fxSubs.push(sub);
            self._applySingleFx(sub, fx);
        });
    },

    _applySingleFx: function (sub, fx) {
        var self = this;
        if (fx === 'aurora') { sub.classList.add('bg-fx-aurora'); return; }
        if (fx === 'sun') { sub.classList.add('bg-fx-sun'); return; }
        if (fx === 'particles') {
            this._spawnTimer(sub, 'bg-particle', 700, function (el) {
                el.style.left = Math.random() * 100 + '%';
                el.style.top = Math.random() * 100 + '%';
                var s = 2 + Math.random() * 3;
                el.style.width = s + 'px';
                el.style.height = s + 'px';
                el.style.animationDuration = (3 + Math.random() * 4) + 's';
            }, 18);
        } else if (fx === 'clouds') {
            this._spawnTimer(sub, 'bg-cloud', 6000, function (el) {
                el.style.top = 5 + Math.random() * 40 + '%';
                el.style.animationDuration = (40 + Math.random() * 40) + 's';
                var s = 0.6 + Math.random() * 1.2;
                el.style.transform = 'scale(' + s + ')';
            }, 6);
        } else if (fx === 'bubbles') {
            this._spawnTimer(sub, 'bg-bubble', 500, function (el) {
                el.style.left = Math.random() * 100 + '%';
                var s = 4 + Math.random() * 12;
                el.style.width = s + 'px';
                el.style.height = s + 'px';
                el.style.animationDuration = (8 + Math.random() * 10) + 's';
            }, 14);
        } else if (fx === 'meteor') {
            this._spawnTimer(sub, 'bg-meteor', 1800, function (el) {
                el.style.left = (20 + Math.random() * 70) + '%';
                el.style.top = (-5 + Math.random() * 15) + '%';
                el.style.animationDuration = (1.2 + Math.random() * 1.2) + 's';
            }, 4);
        } else if (fx === 'rain') {
            this._spawnTimer(sub, 'bg-rain', 90, function (el) {
                el.style.left = Math.random() * 100 + '%';
                el.style.animationDuration = (0.7 + Math.random() * 0.7) + 's';
            }, 60);
        } else if (fx === 'firefly') {
            this._spawnTimer(sub, 'bg-firefly', 900, function (el) {
                el.style.left = Math.random() * 100 + '%';
                el.style.top = 20 + Math.random() * 70 + '%';
                var s = 3 + Math.random() * 4;
                el.style.width = s + 'px';
                el.style.height = s + 'px';
                el.style.animationDuration = (4 + Math.random() * 6) + 's';
            }, 20);
        } else if (fx === 'snow') {
            this._spawnTimer(sub, 'bg-snow', 350, function (el) {
                el.style.left = Math.random() * 100 + '%';
                var s = 3 + Math.random() * 5;
                el.style.width = s + 'px';
                el.style.height = s + 'px';
                el.style.animationDuration = (6 + Math.random() * 8) + 's';
            }, 40);
        } else if (fx === 'star') {
            // 鏄熺┖锛氶潤鎬侀棯鐑佹槦鏄?
            this._spawnTimer(sub, 'bg-particle bg-star-pt', 900, function (el) {
                el.style.left = Math.random() * 100 + '%';
                el.style.top = Math.random() * 100 + '%';
                var s = 1 + Math.random() * 2.5;
                el.style.width = s + 'px';
                el.style.height = s + 'px';
                el.style.opacity = 0.3 + Math.random() * 0.7;
                el.style.animationDuration = (2 + Math.random() * 4) + 's';
                el.style.background = '#fff';
                el.style.borderRadius = '50%';
                el.style.boxShadow = '0 0 ' + (2 + Math.random() * 3) + 'px rgba(255,255,255,.9)';
            }, 90);
        } else if (fx === 'netmouse' || fx === 'fireworks' || fx === 'techwave' || fx === 'orbit' || fx === 'magic' || fx === 'wisps' || fx === 'vortex' || fx === 'comets') {
            // 榧犳爣璺熼殢绫荤壒鏁堬細canvas 缁樺埗锛岃 _startMouseFx
            this._startMouseFx(sub, fx);
        }
    },

    // v5.4.6: 多选 toggle（theme.js 面板调用），"无"为排他清空
    toggleFx: function (fx) {
        if (fx === 'none') {
            this.fxs = [];
        } else {
            var arr = Array.isArray(this.fxs) ? this.fxs.slice() : (this.fxs ? [this.fxs] : []);
            var idx = arr.indexOf(fx);
            if (idx >= 0) arr.splice(idx, 1);
            else { if (arr.length >= 3) arr.shift(); arr.push(fx); }
            this.fxs = arr;
        }
        this.save(); this.apply();
    },

    // ===== 榧犳爣璺熼殢鐗规晥锛坈anvas锛?=====
    _startMouseFx: function (fxLayer, fx) {
        var self = this;
        fxLayer.style.display = 'block';
        var cv = document.createElement('canvas');
        cv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
        fxLayer.appendChild(cv);
        var ctx = cv.getContext('2d');
        var W, H;
        function resize() {
            W = cv.width = window.innerWidth;
            H = cv.height = window.innerHeight;
            // resize 后将 netmouse 锚点收回视口内，防止回家力把节点拉到界外
            for (var i = 0; nodes && i < nodes.length; i++) {
                var n = nodes[i];
                if (n.hx !== undefined) { n.hx = Math.min(Math.max(n.hx, 0), W); n.hy = Math.min(Math.max(n.hy, 0), H); }
            }
        }
        resize();
        window.addEventListener('resize', resize);

        var mouse = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
        var nodes = [];      // netmouse 鐢?

        var orbits = [];     // orbit 鐢?

        if (fx === 'netmouse') {
            for (var i = 0; i < 60; i++) {
                nodes.push({
                    x: Math.random() * W, y: Math.random() * H,
                    hx: 0, hy: 0,   // 出生锚点，用于回家弹力
                    vx: (Math.random() - .5) * .6, vy: (Math.random() - .5) * .6,
                    r: 1 + Math.random() * 2
                });
                var nn = nodes[nodes.length - 1];
                nn.hx = nn.x; nn.hy = nn.y;
            }
        }
        if (fx === 'orbit') {
            for (var k = 0; k < 5; k++) {
                orbits.push({ a: Math.random() * Math.PI * 2, sp: .02 + Math.random() * .05, rr: 30 + k * 22, s: 2 + Math.random() * 2 });
            }
        }
        var sparks = [], waves = [], fwTimer = 0, twTimer = 0;
        var magicRot = 0;                    // magic 魔法阵旋转角
        var wisps = [];                      // wisps 灵光精灵
        var dust = [];                       // vortex 星漩星尘
        var comets = [], cmTimer = 0;        // comets 秘法彗星

        function onMove(e) {
            mouse.x = e.clientX; mouse.y = e.clientY;

        }
        document.addEventListener('mousemove', onMove);
        var raf;
        self._fxCleanups.push(function () {
            document.removeEventListener('mousemove', onMove);
            window.removeEventListener('resize', resize);
            cancelAnimationFrame(raf);
        });
        function draw() {
            ctx.clearRect(0, 0, W, H);
            if (fx === 'netmouse') {
                // 鑺傜偣婕傜Щ + 闈犺繎榧犳爣琚惛寮?
                for (var i = 0; nodes && i < nodes.length; i++) {
                    var n = nodes[i];
                    var dx = mouse.x - n.x, dy = mouse.y - n.y;
                    var d = Math.sqrt(dx * dx + dy * dy);
                    if (d < 220 && d > 1) { n.vx += dx / d * .03; n.vy += dy / d * .03; }
                    // 回家弹力：距锚点越远拉力越强，防止节点永久囤积在鼠标处
                    var hd = Math.hypot(n.hx - n.x, n.hy - n.y);
                    var k = hd > 400 ? 0.003 : 0.001;
                    n.vx += (n.hx - n.x) * k; n.vy += (n.hy - n.y) * k;
                    n.vx *= .98; n.vy *= .98;
                    n.x += n.vx; n.y += n.vy;
                    if (n.x < 0) { n.x = 0; n.vx = Math.abs(n.vx) * .5; }
                    if (n.x > W) { n.x = W; n.vx = -Math.abs(n.vx) * .5; }
                    if (n.y < 0) { n.y = 0; n.vy = Math.abs(n.vy) * .5; }
                    if (n.y > H) { n.y = H; n.vy = -Math.abs(n.vy) * .5; }
                    ctx.beginPath();
                    ctx.arc(n.x, n.y, n.r, 0, 6.28);
                    ctx.fillStyle = 'rgba(90,200,255,.75)';
                    ctx.fill();
                }
                // 杩炵嚎锛氳妭鐐归棿 + 鑺傜偣涓庨紶鏍?
                for (var a = 0; a < nodes.length; a++) {
                    for (var c = a + 1; c < nodes.length; c++) {
                        var p = nodes[a], q2 = nodes[c];
                        var dd = Math.hypot(p.x - q2.x, p.y - q2.y);
                        if (dd < 120) {
                            ctx.strokeStyle = 'rgba(90,200,255,' + (0.28 * (1 - dd / 120)) + ')';
                            ctx.lineWidth = 1;
                            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q2.x, q2.y); ctx.stroke();
                        }
                    }
                    var dm = Math.hypot(nodes[a].x - mouse.x, nodes[a].y - mouse.y);
                    if (dm < 180) {
                        ctx.strokeStyle = 'rgba(140,220,255,' + (0.4 * (1 - dm / 180)) + ')';
                        ctx.beginPath(); ctx.moveTo(nodes[a].x, nodes[a].y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
                    }
                }
                // 榧犳爣鍏夌偣
                ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 3, 0, 6.28);
                ctx.fillStyle = 'rgba(180,240,255,.95)'; ctx.fill();
            } else if (fx === 'orbit') {
                for (var o = 0; o < orbits.length; o++) {
                    var ob = orbits[o];
                    ob.a += ob.sp;
                    var ox = mouse.x + Math.cos(ob.a) * ob.rr;
                    var oy = mouse.y + Math.sin(ob.a) * ob.rr * .55;
                    ctx.beginPath();
                    ctx.arc(ox, oy, ob.s, 0, 6.28);
                    ctx.fillStyle = 'hsla(' + (190 + o * 25) + ',95%,68%,.9)';
                    ctx.shadowColor = 'hsla(' + (190 + o * 25) + ',95%,68%,.9)';
                    ctx.shadowBlur = 10;
                    ctx.fill();
                    ctx.shadowBlur = 0;
                    // 杞ㄩ亾铏氱嚎
                    ctx.beginPath();
                    ctx.setLineDash([3, 6]);
                    ctx.ellipse(mouse.x, mouse.y, ob.rr, ob.rr * .55, 0, 0, 6.28);
                    ctx.strokeStyle = 'hsla(' + (190 + o * 25) + ',90%,65%,.18)';
                    ctx.stroke();
                    ctx.setLineDash([]);
                }
                ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 5, 0, 6.28);
                var g = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 12);
                g.addColorStop(0, 'rgba(255,255,255,.95)');
                g.addColorStop(1, 'rgba(120,200,255,0)');
                ctx.fillStyle = g; ctx.fill();
            }
                        if (fx === 'fireworks') {
                // 鐑熺伀锛氶殢鏈轰綅缃崌璧风垎鐐革紝绮掑瓙鏁ｈ惤
                for (var fi = sparks.length - 1; fi >= 0; fi--) {
                    var sp = sparks[fi];
                    sp.vx *= 0.985; sp.vy = sp.vy * 0.985 + 0.035;
                    sp.x += sp.vx; sp.y += sp.vy; sp.life -= 0.014;
                    if (sp.life <= 0) { sparks.splice(fi, 1); continue; }
                    ctx.beginPath();
                    ctx.arc(sp.x, sp.y, Math.max(0.5, 2.4 * sp.life), 0, 6.28);
                    ctx.fillStyle = 'hsla(' + sp.hue + ',100%,' + (55 + sp.life * 25) + '%,' + sp.life + ')';
                    ctx.shadowColor = 'hsla(' + sp.hue + ',100%,65%,.9)';
                    ctx.shadowBlur = 10;
                    ctx.fill();
                    ctx.shadowBlur = 0;
                }
                if (--fwTimer <= 0 && sparks.length < 260) {
                    fwTimer = 34 + Math.random() * 42;
                    var cx2 = W * (0.15 + Math.random() * 0.7);
                    var cy2 = H * (0.15 + Math.random() * 0.45);
                    var hue2 = Math.random() * 360;
                    var cnt = 44 + (Math.random() * 22 | 0);
                    for (var k2 = 0; k2 < cnt; k2++) {
                        var ang = Math.random() * 6.283;
                        var spd = 1.2 + Math.random() * 2.8;
                        sparks.push({ x: cx2, y: cy2, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, life: 1, hue: hue2 + Math.random() * 40 - 20 });
                    }
                }
            } else if (fx === 'techwave') {
                // 绉戞妧娉細浠庡簳鍚戜笂鎵╂暎鐨勫悓蹇冩壂鎻忔尝绾?+ 缃戞牸鑴夊啿
                twTimer += 1;
                if (twTimer % 90 === 0) waves.push({ r: 0, life: 1 });
                for (var wi2 = waves.length - 1; wi2 >= 0; wi2--) {
                    var wv = waves[wi2];
                    wv.r += 3.2; wv.life -= 0.006;
                    if (wv.life <= 0 || wv.r > Math.max(W, H)) { waves.splice(wi2, 1); continue; }
                    ctx.beginPath();
                    ctx.arc(mouse.x, mouse.y, wv.r, 0, 6.28);
                    ctx.strokeStyle = 'rgba(0,230,255,' + (wv.life * 0.35) + ')';
                    ctx.lineWidth = 1.5;
                    ctx.shadowColor = 'rgba(0,230,255,.8)';
                    ctx.shadowBlur = 8;
                    ctx.stroke();
                    ctx.shadowBlur = 0;
                    // 浜岀骇娉?
                    ctx.beginPath();
                    ctx.arc(mouse.x, mouse.y, wv.r * 0.72, 0, 6.28);
                    ctx.strokeStyle = 'rgba(120,255,220,' + (wv.life * 0.2) + ')';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
                // 榧犳爣澶勯浄杈惧崄瀛?+ 鍏夌偣
                ctx.strokeStyle = 'rgba(0,230,255,.25)';
                ctx.beginPath();
                ctx.moveTo(mouse.x - 26, mouse.y); ctx.lineTo(mouse.x + 26, mouse.y);
                ctx.moveTo(mouse.x, mouse.y - 26); ctx.lineTo(mouse.x, mouse.y + 26);
                ctx.stroke();
                ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 4, 0, 6.28);
                var tg = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 14);
                tg.addColorStop(0, 'rgba(0,255,230,.95)');
                tg.addColorStop(1, 'rgba(0,200,255,0)');
                ctx.fillStyle = tg; ctx.fill();
            } else if (fx === 'magic') {
                // 魔法阵：跟随鼠标的旋转符文阵，缓慢转动 + 呼吸发光
                magicRot += 0.006;
                var mx = mouse.x, my = mouse.y;
                var pulse = 1 + Math.sin(Date.now() / 500) * 0.08;
                var R = 60 * pulse;
                // 外圈双环
                for (var ri = 0; ri < 2; ri++) {
                    ctx.beginPath();
                    ctx.arc(mx, my, R - ri * 12, 0, 6.28);
                    ctx.strokeStyle = 'hsla(' + (270 + ri * 40) + ',90%,70%,.55)';
                    ctx.lineWidth = 2 - ri * 0.7;
                    ctx.shadowColor = 'hsla(280,95%,70%,.8)';
                    ctx.shadowBlur = 12;
                    ctx.stroke();
                }
                ctx.shadowBlur = 0;
                // 内接六芒星（两个三角形，反向旋转）
                for (var tri = 0; tri < 2; tri++) {
                    var dir = tri === 0 ? 1 : -1;
                    ctx.beginPath();
                    for (var ti = 0; ti <= 3; ti++) {
                        var ang = magicRot * dir * 2 + tri * Math.PI / 3 + ti * 2 * Math.PI / 3;
                        var px = mx + Math.cos(ang) * R * 0.8, py = my + Math.sin(ang) * R * 0.8;
                        if (ti === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
                    }
                    ctx.strokeStyle = 'hsla(' + (290 + tri * 30) + ',95%,75%,.6)';
                    ctx.lineWidth = 1.4;
                    ctx.stroke();
                }
                // 环绕符文点
                for (var ri2 = 0; ri2 < 8; ri2++) {
                    var ang2 = magicRot * 1.5 + ri2 * Math.PI / 4;
                    var rx = mx + Math.cos(ang2) * (R - 6), ry = my + Math.sin(ang2) * (R - 6);
                    ctx.beginPath();
                    ctx.arc(rx, ry, 2.2 + Math.sin(Date.now() / 300 + ri2) * 0.8, 0, 6.28);
                    ctx.fillStyle = 'hsla(' + (275 + ri2 * 8) + ',95%,72%,.9)';
                    ctx.shadowColor = 'hsla(280,95%,70%,.9)'; ctx.shadowBlur = 8;
                    ctx.fill(); ctx.shadowBlur = 0;
                }
                // 中心光核
                var mg = ctx.createRadialGradient(mx, my, 0, mx, my, 18);
                mg.addColorStop(0, 'rgba(240,210,255,.95)');
                mg.addColorStop(0.5, 'rgba(180,120,255,.4)');
                mg.addColorStop(1, 'rgba(140,80,255,0)');
                ctx.beginPath(); ctx.arc(mx, my, 18, 0, 6.28); ctx.fillStyle = mg; ctx.fill();
            } else if (fx === 'wisps') {
                // 灵光精灵：一群发光小精灵，围绕鼠标游弋，靠近时被吸引
                if (!wisps.length) for (var wi = 0; wi < 14; wi++) wisps.push({ a: Math.random() * 6.28, rr: 40 + Math.random() * 140, sp: (.008 + Math.random() * .02) * (Math.random() < .5 ? 1 : -1), hu: 150 + Math.random() * 120, wob: Math.random() * 6.28 });
                for (var wi2 = 0; wi2 < wisps.length; wi2++) {
                    var wsp = wisps[wi2];
                    wsp.a += wsp.sp;
                    wsp.rr += (Math.sin(Date.now() / 900 + wsp.wob) * 0.4);
                    var wx = mouse.x + Math.cos(wsp.a) * wsp.rr;
                    var wy = mouse.y + Math.sin(wsp.a * 1.3) * wsp.rr * .7;
                    var flick = 0.55 + Math.sin(Date.now() / 200 + wsp.wob) * 0.35;
                    ctx.beginPath();
                    ctx.arc(wx, wy, 2.5 + flick * 2, 0, 6.28);
                    ctx.fillStyle = 'hsla(' + wsp.hu + ',95%,72%,' + flick + ')';
                    ctx.shadowColor = 'hsla(' + wsp.hu + ',95%,65%,.9)';
                    ctx.shadowBlur = 14;
                    ctx.fill();
                    ctx.shadowBlur = 0;
                    // 拖尾微光
                    ctx.beginPath();
                    ctx.arc(wx - Math.cos(wsp.a) * 5, wy - Math.sin(wsp.a * 1.3) * 4, 1.2, 0, 6.28);
                    ctx.fillStyle = 'hsla(' + wsp.hu + ',95%,80%,' + (flick * 0.4) + ')';
                    ctx.fill();
                }
            } else if (fx === 'vortex') {
                // 星漩：鼠标周围星尘被卷入漩涡旋转
                if (!dust.length) for (var di = 0; di < 90; di++) dust.push({ x: Math.random() * W, y: Math.random() * H, hu: 200 + Math.random() * 90, s: 0.6 + Math.random() * 1.8 });
                for (var di2 = 0; di2 < dust.length; di2++) {
                    var d2 = dust[di2];
                    var ddx = mouse.x - d2.x, ddy = mouse.y - d2.y;
                    var dist = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
                    var pull = Math.max(0, 1 - dist / 260) * 1.2;
                    // 切向速度（漩涡）+ 向心吸引
                    var tx = -ddy / dist, ty = ddx / dist;
                    d2.x += tx * (0.6 + pull * 4) + (ddx / dist) * pull * 2;
                    d2.y += ty * (0.6 + pull * 4) + (ddy / dist) * pull * 2;
                    // 太近则重生到远处
                    if (dist < 12) { d2.x = mouse.x + (Math.random() - .5) * W; d2.y = mouse.y + (Math.random() - .5) * H; }
                    // 越界环绕
                    if (d2.x < 0) d2.x += W; if (d2.x > W) d2.x -= W;
                    if (d2.y < 0) d2.y += H; if (d2.y > H) d2.y -= H;
                    ctx.beginPath();
                    ctx.arc(d2.x, d2.y, d2.s + pull, 0, 6.28);
                    ctx.fillStyle = 'hsla(' + d2.hu + ',90%,75%,' + (0.35 + pull * 0.6) + ')';
                    ctx.fill();
                }
                // 漩涡眼
                ctx.beginPath(); ctx.arc(mouse.x, mouse.y, 3, 0, 6.28);
                ctx.fillStyle = 'rgba(220,240,255,.9)'; ctx.fill();
            } else if (fx === 'comets') {
                // 秘法彗星：随机生成从鼠标位置射出的魔法彗星，带彩色拖尾
                if (--cmTimer <= 0 && comets.length < 8) {
                    cmTimer = 40 + Math.random() * 60;
                    var cang = Math.random() * 6.28, csp = 3 + Math.random() * 4;
                    comets.push({ x: mouse.x, y: mouse.y, vx: Math.cos(cang) * csp, vy: Math.sin(cang) * csp, hu: Math.random() * 360, life: 1 });
                }
                for (var ci = comets.length - 1; ci >= 0; ci--) {
                    var cm = comets[ci];
                    cm.x += cm.vx; cm.y += cm.vy;
                    cm.vx *= 0.995; cm.vy = cm.vy * 0.995 + 0.015;
                    cm.life -= 0.006;
                    if (cm.life <= 0 || cm.x < -50 || cm.x > W + 50 || cm.y > H + 50) { comets.splice(ci, 1); continue; }
                    // 头部
                    ctx.beginPath();
                    ctx.arc(cm.x, cm.y, 3.2, 0, 6.28);
                    ctx.fillStyle = 'hsla(' + cm.hu + ',100%,80%,' + cm.life + ')';
                    ctx.shadowColor = 'hsla(' + cm.hu + ',100%,65%,.9)';
                    ctx.shadowBlur = 14; ctx.fill(); ctx.shadowBlur = 0;
                    // 拖尾
                    ctx.beginPath();
                    ctx.moveTo(cm.x, cm.y);
                    ctx.lineTo(cm.x - cm.vx * 10, cm.y - cm.vy * 10);
                    var lg = ctx.createLinearGradient(cm.x, cm.y, cm.x - cm.vx * 10, cm.y - cm.vy * 10);
                    lg.addColorStop(0, 'hsla(' + cm.hu + ',100%,75%,' + (cm.life * 0.7) + ')');
                    lg.addColorStop(1, 'hsla(' + cm.hu + ',100%,60%,0)');
                    ctx.strokeStyle = lg; ctx.lineWidth = 2.2; ctx.stroke();
                }
            }
            raf = requestAnimationFrame(draw);
        }
        raf = requestAnimationFrame(draw);
    },
    _spawnTimer: function (fxLayer, cls, interval, styleFn, max) {
        var self = this;
        function spawn() {
            var _pf0 = (window.Perf ? performance.now() : 0);
            // 页面隐藏时浏览器节流 setInterval/setTimeout（>=1s 甚至 1 分钟），
            // 移除定时器被延迟 -> 子元素堆积超上限 -> spawn 全部 return，特效"时间长了消失"。
            if (document.hidden) return;
            if (fxLayer.children.length > max + 20) {
                // 超上限时淘汰最老元素兜底，避免特效停摆
                while (fxLayer.children.length > max && fxLayer.firstChild) {
                    fxLayer.removeChild(fxLayer.firstChild);
                }
            }
            var el = document.createElement('div');
            el.className = cls;
            styleFn(el);
            fxLayer.appendChild(el);
            if (window.Perf && _pf0) Perf.mark('背景:spawn-' + cls, _pf0);
            // 按元素自身动画时长移除（修复：原固定 55s 才移除，infinite 动画导致
            // children 堆积超过 max+20 上限后 spawn 直接 return，特效"开始有后来消失"）
            var dur = parseFloat(el.style.animationDuration);
            if (!dur || dur <= 0 || !isFinite(dur)) {
                try { dur = parseFloat(getComputedStyle(el).animationDuration) || 0; } catch (e) { dur = 0; }
            }
            // 仅有限动画按动画时长移除；infinite 动画靠上面超限淘汰兜底
            var ic = '1';
            try { ic = getComputedStyle(el).animationIterationCount || '1'; } catch (e) {}
            if (ic.indexOf('infinite') < 0) {
                setTimeout(function () {
                    if (el.parentNode) el.parentNode.removeChild(el);
                }, dur > 0 ? (dur * 1000 + 500) : 55000);
            }
        }
        for (var i = 0; i < max; i++) spawn();
        this._fxTimers.push(setInterval(spawn, interval));
    },

    // ===== 面板 UI =====
    _setupUI: function () {
        var self = this;

        function q(id) { return document.getElementById(id); }

        // v30: 背景图片模式已移除，永远纯色
        var mDef = q('bgModeDefault'), mColor = q('bgModeColor'), mImg = q('bgModeImage');
        if (mDef) mDef.addEventListener('click', function () { self.mode = 'color'; self.save(); self.apply(); });
        if (mColor) mColor.addEventListener('click', function () { self.mode = 'color'; self.save(); self.apply(); });

        // 背景方案卡片
        var grid = q('bgSchemeGrid');
        if (grid) {
            grid.innerHTML = '';
            this.schemes.forEach(function (sc) {
                var card = document.createElement('div');
                card.className = 'bg-scheme-card' + (self.scheme && self.scheme.id === sc.id ? ' active' : '');
                card.title = sc.name;
                var sw = document.createElement('div');
                sw.className = 'bg-scheme-sw';
                sw.style.background = sc.css;
                var nm = document.createElement('span');
                nm.textContent = sc.name;
                card.appendChild(sw); card.appendChild(nm);
                card.addEventListener('click', function () {
                    self.scheme = sc; self.color = sc.accent; self.mode = 'color';
                    Array.prototype.forEach.call(grid.children, function (c) { c.classList.remove('active'); });
                    card.classList.add('active');
                    self.save(); self.apply();
                });
                grid.appendChild(card);
            });
        }

        // v30: 图片模式已移除，跳过相关 UI 绑定
        /*
        if (urlInput) {
            urlInput.addEventListener('change', function () {
                self.imageUrl = this.value.trim();
                self.save(); self.apply(); self._updatePreview();
            });
        }
        var browse = q('bgImageBrowse');
        if (browse) browse.addEventListener('click', function () {
            var input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.onchange = function () {
                var file = input.files && input.files[0];
                if (!file) return;
                var reader = new FileReader();
                reader.onload = function () {
                    self.imageUrl = reader.result; // dataURL
                    if (urlInput) urlInput.value = '(本地图片已加载)';
                    self.save(); self.apply(); self._updatePreview();
                };
                reader.readAsDataURL(file);
            };
            input.click();
        });
        var blurChk = q('bgImageBlur');
        if (blurChk) blurChk.addEventListener('change', function () { self.imageBlur = this.checked; self.save(); self.apply(); });
        var darkChk = q('bgImageDark');
        if (darkChk) darkChk.addEventListener('change', function () { self.imageDark = this.checked; self.save(); self.apply(); });
        */

        // 特效按钮：theme.js setupFxGrid 已统一绑定（v5.4.7）——此处不再重复绑定，
        // 否则同一按钮两个监听器都调 toggleFx，点一下 = toggle 两次 = 状态原样，表现为"点不动"
    },

    _updatePreview: function () {
        var pv = document.getElementById('bgImagePreview');
        if (!pv) return;
        if (this.mode === 'image' && this.imageUrl) {
            pv.style.display = 'block';
            pv.style.backgroundImage = 'url("' + this.imageUrl.replace(/"/g, '\\"') + '")';
        } else {
            pv.style.display = 'none';
        }
    },

    // ===== 同步面板高亮 =====
    _updateUI: function () {
        var q = function (id) { return document.getElementById(id); };
        var map = { color: 'bgModeColor' }; // v30: 图片按钮已移除
        Object.keys(map).forEach(function (k) {
            var b = q(map[k]);
            if (b) b.classList.toggle('active', Background.mode === k);
        });
        var cp = q('bgColorPanel');
        if (cp) cp.style.display = this.mode === 'color' ? 'block' : 'none';
        var ip = q('bgImagePanel');
        if (ip) ip.style.display = this.mode === 'image' ? 'block' : 'none';
        var blurChk = q('bgImageBlur');
        if (blurChk) blurChk.checked = this.imageBlur;
        var darkChk = q('bgImageDark');
        if (darkChk) darkChk.checked = this.imageDark;
        var fxsNow = Background.fxs || [];
        Array.prototype.forEach.call(document.querySelectorAll('.bg-fx-btn'), function (el) {
            var id = el.getAttribute('data-fx');
            if (id === 'none') el.classList.toggle('active', fxsNow.length === 0);
            else el.classList.toggle('active', fxsNow.indexOf(id) >= 0);
        });
        this._updatePreview();
    },

    // ===== 重置 =====
    reset: function () {
        this.mode = 'color';
        this.color = '#0a0e1a';
        this.imageUrl = '';
        this.imageBlur = true;
        this.imageDark = true;
        this.fxs = ['none'];
        this.fx = 'none';
        var urlInput = document.getElementById('bgImageUrl');
        if (urlInput) urlInput.value = '';
        this.scheme = null;
        // 清除色块选中高亮
        Array.prototype.forEach.call(document.querySelectorAll('#bgSchemeGrid .bg-scheme-card'), function (c) { c.classList.remove('active'); });
        this.save();
        this.apply();
    }
};

// 页面就绪后初始化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { Background.init(); });
} else {
    Background.init();
}
