/**
 * background.js - 画布背景管理器
 * ģʽ：color(纯ɫ，Ĭ认) / image(ͼƬ)，星空已融合进背景样ʽ
 * 特Ч独立叠加，Ĭ认关闭（none）
 * 配置持久化：localStorage zf_background + UserSettings 兼容
 */
var BG_ASSET_INTERVAL_DEFAULT = 30000; // v33: 图片按间隔轮播；视频模式为最短停留时长（播完整遍才切，不中途掐断），默认 30s
var CHATBOX_OPACITY_DEFAULT = 0.18;    // 对话框壁纸不透明度默认值（收口：消除 0.18 字面量 4 处重复）

var Background = {
    mode: 'color',          // color | image
    color: '#0d1117',
    // v32 新字段：bgAssetInterval(ms) / bgAssetLocked(锁定索引|null) / bgAssetsCustom(自定义池|null) / bgAssetBlend(融合模式) / chatboxBg(对话框背景开关)
    bgAssetInterval: BG_ASSET_INTERVAL_DEFAULT,
    bgAssetLocked: null,
    bgAssetsCustom: null,
    bgAssetBlend: false,
    chatboxOpacity: CHATBOX_OPACITY_DEFAULT,
    chatboxBg: false,
    scheme: null,           // Ĭ认方案：īҹ grad-inkblue（init ʱ设置）
    imageUrl: '',
    imageBlur: true,
    imageDark: true,
    fxs: ['grid'],      // 网格（Ĭ认特Ч，多ѡ数组 v5.4.6）

    _fxTimers: [],
    _fxCleanups: [],
    _fxSubs: [],
    _fxLayer: null,
    _parallaxRAF: null,

    // ===== 初ʼ化 =====
    init: function () {
        var self = this;
        this._buildLayer();
        // 首次无存储ʱĬ认方案：īҹ
        if (!this.scheme) {
            for (var k = 0; k < this.schemes.length; k++) {
                if (this.schemes[k].id === 'solid-ink') { this.scheme = this.schemes[k]; break; }
            }
        }
        this.apply();
        this._setupUI();
        // 异步从服务器加载已保存的背景配置，到达后覆盖当ǰĬ认ֵ
        this._loadFromServer(function (saved) {
            if (saved) {
                self.mode = 'color'; // v30: ͼƬģʽ已移除
                self.color = saved.color || '#0d1117';
                // v5.4.6: fx→fxs 数组化，兼容旧单ֵ存档
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
                    // 用户纯色（schemeId=null）：保持 scheme=null，尊重用户自选背景色。
                    // 修复“背景色记不住”：此前这里强制回退「墨夜」方案，覆盖用户纯色
                    self.scheme = null;
                }
                // ===== 素材动态背景（v31: 图片轮播/视频，持久化复用同一 JSON） =====
                self.bgAssets = saved.bgAssets || null;      // null=未启用；数组=素材url列表
                self.bgAssetMode = saved.bgAssetMode || '';  // 'image' | 'video' | ''
                self.bgVeil = (typeof saved.bgVeil === 'number') ? saved.bgVeil : 0.5; // veil 强度 0~1【收口整改：0.8→0.5，0.8 过重致素材背景几乎不可见】
                // v32 新字段加载
                self.bgAssetInterval = (typeof saved.bgAssetInterval === 'number' && saved.bgAssetInterval >= 3000) ? saved.bgAssetInterval : BG_ASSET_INTERVAL_DEFAULT;
                self.bgAssetLocked = (typeof saved.bgAssetLocked === 'number') ? saved.bgAssetLocked : null;
                self.bgAssetsCustom = saved.bgAssetsCustom || null;
                self.bgAssetBlend = !!saved.bgAssetBlend;
                self.chatboxOpacity = (typeof saved.chatboxOpacity === 'number') ? saved.chatboxOpacity : CHATBOX_OPACITY_DEFAULT;
                self.chatboxBg = !!saved.chatboxBg;
                self._assetIndex = self.bgAssetLocked || 0;
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
                fx: (this.fxs && this.fxs[0]) || '',
                bgAssets: this.bgAssets || null,
                bgAssetMode: this.bgAssetMode || '',
                bgVeil: this.bgVeil,
                bgAssetInterval: this.bgAssetInterval || BG_ASSET_INTERVAL_DEFAULT,
                bgAssetLocked: (typeof this.bgAssetLocked === 'number') ? this.bgAssetLocked : null,
                bgAssetsCustom: this.bgAssetsCustom || null,
                bgAssetBlend: !!this.bgAssetBlend,
                chatboxOpacity: (typeof this.chatboxOpacity === 'number') ? this.chatboxOpacity : CHATBOX_OPACITY_DEFAULT,
                chatboxBg: !!this.chatboxBg
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
        return null; // 改Ϊ异步加载，见 _loadFromServer
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
                // 服务器无配置ʱ，回退 localStorage（升级兼容），并回д服务器
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
                // 服务器不可用ʱ回退 localStorage
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
        // v31: 素材层（图片轮播/视频）与 veil 蒙版层，位于 bgCustomLayer 之下、特效层之上
        var assetLayer = document.createElement('div');
        assetLayer.id = 'bgAssetLayer';
        assetLayer.style.cssText = 'position:absolute;inset:0;z-index:0;display:none;overflow:hidden';
        var veil = document.createElement('div');
        veil.id = 'bgVeilLayer';
        veil.style.cssText = 'position:absolute;inset:0;z-index:0;display:none;pointer-events:none;transition:opacity .3s';
        canvasArea.insertBefore(fxLayer, canvasArea.firstChild);
        canvasArea.insertBefore(veil, fxLayer);
        canvasArea.insertBefore(assetLayer, veil);
        canvasArea.insertBefore(layer, assetLayer);
        this._fxLayer = fxLayer;
    },

    // ===== 鼠标视差浮动：让特Ч层随鼠标΢΢移动 =====
    _setupParallax: function () {
        var self = this;
        if (self._parallaxBound) return;
        self._parallaxBound = true;
        var target = { x: 0, y: 0 }, cur = { x: 0, y: 0 };
        var AMPLITUDE = 14; // 最大ƫ移像素
        document.addEventListener('mousemove', function (e) {
            target.x = (e.clientX / window.innerWidth - 0.5) * 2;   // -1 ~ 1
            target.y = (e.clientY / window.innerHeight - 0.5) * 2;
        }, { passive: true });
        function tick() {
            cur.x += (target.x - cur.x) * 0.06; // 缓动，柔和跟随
            cur.y += (target.y - cur.y) * 0.06;
            var layer = self._fxLayer || document.getElementById('bgFxLayer');
            if (layer) {
                layer.style.transform = 'translate3d(' + (-cur.x * AMPLITUDE).toFixed(2) + 'px,' + (-cur.y * AMPLITUDE).toFixed(2) + 'px,0) scale(1.05)'; // scale 补偿，防ֹƽ移后¶边
            }
            self._parallaxRAF = requestAnimationFrame(tick);
        }
        tick();
    },

    // ===== Ӧ用背景 =====
    // 拖קȡɫʱ的轻量Ӧ用：ֻ更新背景ɫ和面板 CSS 变量，不触发 save/特Ч重建/UI ȫ量ˢ新
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

    // ===== 背景方案（渐变，用户点ѡ） =====
    schemes: [
        // ---- 纯ɫ 10（黑 → 灰 → 白/亮，按亮度升序）----
        { id: 'solid-ink',    name: 'īҹ',   css: '#0d1117', accent: '#1c2530' },
        { id: 'slate',        name: '深空灰', css: '#1c2530', accent: '#2c3a4d' },
        { id: 'navy',         name: '藏蓝',   css: '#12263f', accent: '#1f4470' },
        { id: 'wine',         name: '酒红',   css: '#4a1f27', accent: '#7a3242' },
        { id: 'pine',         name: '松绿',   css: '#1f4536', accent: '#2f6b52' },
        { id: 'tealgray',     name: '青灰',   css: '#2d4a53', accent: '#3f6b78' },
        { id: 'amber',        name: '琥珀',   css: '#7a4a12', accent: '#b0741f' },
        { id: 'violet',       name: '亮紫',   css: '#8b5cf6', accent: '#a78bfa' },
        { id: 'skyblue',      name: '天蓝',   css: '#2d7dd2', accent: '#5aa3e8' },
        { id: 'lake',         name: '湖绿',   css: '#17a398', accent: '#3cc9be' },
        // ---- 渐变 10（按起ʼɫ亮度升序）----
        { id: 'grad-graphite', name: '曜ʯ灰', css: 'linear-gradient(to top,#121418,#23262e)', accent: '#3a3f4c' },
        { id: 'grad-inkblue',  name: 'ī蓝',   css: 'linear-gradient(to top,#0c1626,#1c2f4a)', accent: '#34517e' },
        { id: 'grad-wine',     name: '酒红ҹ', css: 'linear-gradient(to top,#241018,#542437)', accent: '#a04a66' },
        { id: 'grad-plum',     name: '紫ҹ',   css: 'linear-gradient(to top,#1a1230,#3b2a63)', accent: '#6d4fc4' },
        { id: 'grad-forest',   name: '深林',   css: 'linear-gradient(to top,#0d1f18,#1d4030)', accent: '#2f6b52' },
        { id: 'grad-dawn',     name: '曙光橙', css: 'linear-gradient(to top,#2b1a10,#8a5a24)', accent: '#d99a3e' },
        { id: 'grad-rainbow',  name: '彩虹晨', css: 'linear-gradient(to top,#251540,#7c3aed,#e879a0)', accent: '#a855f7' },
        { id: 'grad-sakura',   name: 'ӣ粉',   css: 'linear-gradient(to top,#3a1a2e,#c4789e)', accent: '#e39ac0' },
        { id: 'grad-steel',    name: '苍青',   css: 'linear-gradient(to top,#123038,#2b6e70)', accent: '#4aa0a2' },
        { id: 'grad-bluesky',  name: '青空',   css: 'linear-gradient(to top,#163a5e,#4a9bd8)', accent: '#6fb6e8' },
        // ---- 灰ɫ + 颜ɫ渐变 5 ----
        { id: 'grad-greyblue',  name: '灰蓝',   css: 'linear-gradient(to top,#2a2d33,#3f5a78)', accent: '#5b82ab' },
        { id: 'grad-greypurple',name: '灰紫',   css: 'linear-gradient(to top,#2c2a33,#5a4a78)', accent: '#7d68a8' },
        { id: 'grad-greygreen', name: '灰绿',   css: 'linear-gradient(to top,#2a2f2c,#3f6b58)', accent: '#5a9478' },
        { id: 'grad-greyrose',  name: '灰粉',   css: 'linear-gradient(to top,#332a2e,#784a5e)', accent: '#a86b84' },
        { id: 'grad-greyamber', name: '灰金',   css: 'linear-gradient(to top,#2f2c26,#6e5a2f)', accent: '#a8894a' },
        // ---- 白ɫ + 颜ɫ渐变 5 ----
        { id: 'grad-whiteblue', name: '白云蓝', css: 'linear-gradient(to top,#e8eef5,#6fa8dc)', accent: '#4a86c8' },
        { id: 'grad-whitepurple',name:'白云紫', css: 'linear-gradient(to top,#f0ebf5,#a87fd0)', accent: '#8a5fc0' },
        { id: 'grad-whitegreen',name: '白青绿', css: 'linear-gradient(to top,#eaf5ee,#5fbf8a)', accent: '#3a9e68' },
        { id: 'grad-whiterose', name: '白ӣ粉', css: 'linear-gradient(to top,#f5eef0,#e08fae)', accent: '#c86a90' },
        { id: 'grad-whiteamber',name: '白琥珀', css: 'linear-gradient(to top,#f5f0e5,#e0b45f)', accent: '#c8963a' },
        // ---- 白色系高级渐变 6（低饱和·白净柔和，配浅色 UI）----
        { id: 'grad-motherwhite', name: '云母白', css: 'linear-gradient(135deg,#ffffff 0%,#f3f5fb 45%,#e9edf7 100%)', accent: '#eef1f8', light: true },
        { id: 'grad-moonwhite', name: '月华白', css: 'linear-gradient(135deg,#ffffff 0%,#eef3fb 50%,#e2ebf6 100%)', accent: '#e7eff9', light: true },
        { id: 'grad-sakurawhite', name: '樱雾白', css: 'linear-gradient(135deg,#ffffff 0%,#fdf1f5 50%,#f8e9f0 100%)', accent: '#fbeef4', light: true },
        { id: 'grad-pinewhite', name: '雾松白', css: 'linear-gradient(135deg,#ffffff 0%,#eef7f2 50%,#e4f1ea 100%)', accent: '#ebf5f0', light: true },
        { id: 'grad-dawnwhite', name: '晨曦白', css: 'linear-gradient(135deg,#ffffff 0%,#fdf6ec 50%,#f9efe0 100%)', accent: '#fbf1e4', light: true },
        { id: 'grad-lavwhite', name: '薰衣草白', css: 'linear-gradient(135deg,#ffffff 0%,#f4f1fb 50%,#ece7f7 100%)', accent: '#f0ecf9', light: true },
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
        if (this.scheme && this.scheme.light) {
            // 浅色方案（白色系渐变）：配浅色半透明面板 + 深色字，避免白画布叠深色浮层割裂
            body.style.setProperty('--kite-panel-bg', 'rgba(255,255,255,.86)');
            body.style.setProperty('--kite-panel-border', 'rgba(60,80,120,.18)');
            body.style.setProperty('--kite-panel-text', '#2a3340');
        } else {
            body.style.setProperty('--kite-panel-bg', 'rgba(10,14,26,.82)');
            body.style.setProperty('--kite-panel-border', 'rgba(255,255,255,.18)');
            body.style.setProperty('--kite-panel-text', '#e6ecf7');
        }
    },

    apply: function () {
        var layer = document.getElementById('bgCustomLayer');
        var body = document.body;
        if (!layer) return;

        // ===== 用户自定义背景标记：供白天主题补丁等样ʽ跟随自定义背景ɫ =====
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

        // ===== 风筝ͳ计面板跟随背景颜ɫ =====
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
            // Ĭ认星空 / ͼƬ背景：还ԭĬ认样ʽ
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
            // 纯ɫ / 渐变方案
            layer.style.display = 'block';
            layer.style.background = (this.scheme && this.scheme.css) ? this.scheme.css : this.color;
        }
        // 特ЧΪ独立叠加层，Ĭ认关闭；星空 canvas 常פ跟随背景样ʽ
        var star = document.getElementById('starfield');
        if (star) star.style.display = '';

        this._applyAssetBg();
        this._applyFx();
        this._updateUI();
    },

    // ===== 特Ч（v5.4.6 多ѡ：ÿ个 fx һ个 .bg-fx-sub 子层）=====
    // ===== v31 素材动态背景引擎（图片轮播 / 视频 + veil 蒙版） =====
    // 【收口整改】删除 UI师指出的死链兜底清单（约定名 bg-N.jpg 与实际 grok-* 文件不符，
    // 接口失败时回退只会全 404 黑屏）→ 改为空数组，扫描失败时给用户 toast 提示
    BG_ASSET_IMAGES: [],
    BG_ASSET_VIDEOS: [],

    _assetToast: function (msg) {
        var t = document.getElementById('bgAssetToast');
        if (!t) {
            t = document.createElement('div');
            t.id = 'bgAssetToast';
            t.style.cssText = 'position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:99999;padding:8px 18px;border-radius:9px;background:rgba(30,34,44,.92);color:#eef;font-size:13px;pointer-events:none;opacity:0;transition:opacity .3s';
            document.body.appendChild(t);
        }
        t.textContent = msg;
        t.style.opacity = '1';
        clearTimeout(this._toastTimer);
        this._toastTimer = setTimeout(function () { t.style.opacity = '0'; }, 2600);
    },

    _scanAssets: function (cb) {
        // 按约定目录扫描可用素材（走服务器扫描接口；失败时提示用户，不再回退死链清单）
        var self = this;
        fetch('/api/background/assets').then(function (r) { return r.json(); }).then(function (res) {
            if (res && res.ok && res.images && res.images.length) {
                self._imgList = res.images; self._vidList = res.videos || [];
            } else {
                self._imgList = []; self._vidList = [];
                self._assetToast('背景素材扫描失败：请确认服务已重启且 public/i桌面/ 目录存在');
            }
            if (cb) cb();
        }).catch(function () {
            self._imgList = []; self._vidList = [];
            self._assetToast('背景素材接口不可达：请重启服务后重试');
            if (cb) cb();
        });
    },

    _stopAssetEngine: function () {
        if (this._assetTimer) { clearInterval(this._assetTimer); this._assetTimer = null; }
        if (this._stallTimer) { clearInterval(this._stallTimer); this._stallTimer = null; } // v33b: 看门狗随引擎停
        var al = document.getElementById('bgAssetLayer');
        if (al) { al.style.display = 'none'; al.innerHTML = ''; }
        var veil = document.getElementById('bgVeilLayer');
        if (veil) veil.style.display = 'none';
        this._onVisHandler && document.removeEventListener('visibilitychange', this._onVisHandler);
        this._onVisHandler = null;
        this._curV = null; // v33: 视频引擎状态随引擎一并清掉
        if (this._curPre) { try { this._curPre.removeAttribute('src'); this._curPre.load(); } catch (e) {} this._curPre = null; }
        this._assetShownAt = 0;
        this._applyChatboxBg();
    },

    _applyVeil: function () {
        var veil = document.getElementById('bgVeilLayer');
        if (!veil) return;
        // v32【反驳①②/进化①】：veil 颜色跟随用户背景色（scheme.css 或 color，动态取值不写死 rgba，主题安全）；
        // 融合模式(bgAssetBlend)开：veil 同色叠加仍压暗素材 → opacity 置 0 旁路压暗，达成"黑底视频与黑背景融合"
        var bg = (this.scheme && this.scheme.css) ? this.scheme.css : (this.color || '#0d1117');
        veil.style.background = bg;
        veil.style.opacity = this.bgAssetBlend ? 0 : this.bgVeil;
    },

    _applyAssetBg: function () {
        var self = this;
        this._stopAssetEngine();
        if (!this.bgAssets || !this.bgAssets.length || !this.bgAssetMode) return;
        var al = document.getElementById('bgAssetLayer');
        if (!al) return;
        al.style.display = 'block';
        this._applyVeil();
        var veil = document.getElementById('bgVeilLayer');
        if (veil) veil.style.display = 'block';

        // v32: 修复上一会话残留语法残缺（const 插入表达式内）→ 常量已提至对象外
        if (this.bgAssetMode === 'video') {
            // v33: 视频轮播改为"播完整遍才切"（ended 驱动）。旧 v32 固定定时器会在视频中途硬切：
            // 实测素材 6s/个、用户存档间隔 16s → 每个视频循环到一半被掐断；且旧层"创建后固定1400ms
            // 即销毁"在新视频尚未起播时露出黑底 → 用户反馈"出现几秒就黑、播放不完整"。
            // 新策略：轮播池内 loop=false，自然播完(ended)时已满最短停留间隔则切下一个、未满则重播本条；
            // 旧视频保留做底直到新视频真正起播后才销毁，切换全程无黑屏。
            var idx = this._assetIndex || 0;
            if (idx >= this.bgAssets.length) idx = 0;
            this._assetIndex = idx;
            var playAt = function (i) {
                self._assetIndex = i;
                self._assetShownAt = Date.now();
                // 渐变过渡：旧视频保留在层上做底，新视频淡入后移除旧层
                var oldV = self._curV || al.querySelector('video');
                // 垫底期立刻 loop=true：新视频缓冲期间旧视频不得中途结束露黑帧
                if (oldV && oldV.parentNode) oldV.loop = true;
                if (self._curPre) { try { self._curPre.removeAttribute('src'); self._curPre.load(); } catch (e) {} self._curPre = null; }
                var v = document.createElement('video');
                v.src = self.bgAssets[i];
                v.muted = true; v.playsInline = true;
                v.autoplay = true; v.preload = 'auto';
                // 锁定/池内仅1条：无限循环不轮播；轮播池：播完一整遍由 ended 决定切下一个或重播
                v.loop = (self.bgAssetLocked != null || self.bgAssets.length <= 1);
                v.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 1.2s ease;z-index:2';
                al.appendChild(v);
                self._curV = v;
                var started = false;
                var tryPlay = function () {
                    if (started) return; // canplay/loadeddata 双监听只起播一次
                    started = true;
                    v.style.opacity = '1';
                    var p = v.play();
                    if (p && p.catch) p.catch(function (e) {
                        // 自动播放被拒兜底：再试一次（部分浏览器首次交互前拒绝，静音后通常可播）
                        setTimeout(function () { var p2 = v.play(); if (p2 && p2.catch) p2.catch(function () {}); }, 300);
                    });
                    // v33: 新视频真正起播后才销毁旧视频（从起播起算淡入1.2s+余量）——修切换黑屏；
                    // 新视频起不来则旧视频一直垫底，不再定时裸删
                    setTimeout(function () {
                        if (oldV && oldV.parentNode) oldV.parentNode.removeChild(oldV);
                    }, 1400);
                };
                v.addEventListener('canplay', tryPlay, { once: true });
                v.addEventListener('loadeddata', tryPlay, { once: true });
                // 播完一整遍：满最短停留间隔→切下一个；未满→重播本条（永不中途掐断）
                v.addEventListener('ended', function () {
                    if (self._curV !== v || self.bgAssetLocked != null) return;
                    var elapsed = Date.now() - (self._assetShownAt || 0);
                    if (elapsed >= (self.bgAssetInterval || BG_ASSET_INTERVAL_DEFAULT)) {
                        playAt((self._assetIndex + 1) % self.bgAssets.length);
                        self._updateAssetBar();
                    } else {
                        try { v.currentTime = 0; } catch (e) {}
                        var p = v.play(); if (p && p.catch) p.catch(function () {});
                    }
                });
                // 加载失败兜底：停1.5s跳下一个防卡死（成功路径不经此处，不影响完整播放）
                v.addEventListener('error', function () {
                    if (self._curV !== v || self.bgAssetLocked != null) return;
                    setTimeout(function () {
                        if (self._curV !== v || self.bgAssetLocked != null) return;
                        playAt((self._assetIndex + 1) % self.bgAssets.length);
                        self._updateAssetBar();
                    }, 1500);
                });
                // 预缓冲下一条（挂 self 防 GC；v32 在切换瞬间才建 pv2，等于没预缓冲）
                if (self.bgAssets.length > 1) {
                    var pv = document.createElement('video');
                    pv.src = self.bgAssets[(i + 1) % self.bgAssets.length];
                    pv.preload = 'auto'; pv.muted = true;
                    self._curPre = pv;
                }
            };
            playAt(idx);
            this._onVisHandler = function () {
                // v33: 遍历全部 video——交叉淡入窗口内新旧两枚并存，querySelector 只会拿到旧的那枚
                Array.prototype.forEach.call(al.querySelectorAll('video'), function (cv) {
                    if (document.hidden) { cv.pause(); }
                    else { var p = cv.play(); if (p && p.catch) p.catch(function () {}); }
                });
            };
            document.addEventListener('visibilitychange', this._onVisHandler);
            // v33b: 卡停看门狗——服务器旧无 Range 出口时代视频常中途停住（ended 永不触发，轮播死等）。
            // 服务器已修，仍留兜底：每 5s 采样 currentTime；ended/意外暂停→促播；
            // 停滞先促播一次，连续 3 次（约15s）零进度→放弃本条（轮播切下一个，锁定/单视频重播本条）
            if (this._stallTimer) clearInterval(this._stallTimer);
            var lastPos = -1, stallN = 0;
            this._stallTimer = setInterval(function () {
                if (document.hidden) return;
                var cv = self._curV;
                if (!cv || cv.parentNode !== al) return;
                if (cv.ended || cv.paused) {
                    var pr = cv.play(); if (pr && pr.catch) pr.catch(function () {});
                    stallN = 0; lastPos = cv.currentTime;
                    return;
                }
                if (Math.abs(cv.currentTime - lastPos) > 0.2) { stallN = 0; lastPos = cv.currentTime; return; }
                stallN++;
                if (stallN === 1) { lastPos = cv.currentTime; var pr2 = cv.play(); if (pr2 && pr2.catch) pr2.catch(function () {}); return; }
                if (stallN >= 3) {
                    stallN = 0; lastPos = -1;
                    if (self.bgAssetLocked == null && self.bgAssets.length > 1) {
                        playAt((self._assetIndex + 1) % self.bgAssets.length);
                    } else {
                        try { cv.currentTime = 0; } catch (e) {}
                        var pr3 = cv.play(); if (pr3 && pr3.catch) pr3.catch(function () {});
                    }
                    self._updateAssetBar();
                }
            }, 5000);
        } else {
            // 图片轮播：双 div 交叉淡入淡出 1.2s，预加载下一张；v32: 锁定/间隔可配
            var idx = this._assetIndex || 0;
            if (idx >= this.bgAssets.length) idx = 0;
            this._assetIndex = idx;
            function show(url) {
                var d = document.createElement('div');
                d.style.cssText = 'position:absolute;inset:0;background:url("' + url + '") center/cover no-repeat;opacity:0;transition:opacity 1.2s ease';
                al.appendChild(d);
                requestAnimationFrame(function () { d.style.opacity = '1'; });
                setTimeout(function () {
                    while (al.children.length > 2 && al.firstChild) al.removeChild(al.firstChild);
                }, 1400);
            }
            var im = new Image();
            im.src = this.bgAssets[idx];
            show(this.bgAssets[idx]);
            this._assetTimer = setInterval(function () {
                if (document.hidden) return;
                if (self.bgAssetLocked != null) { self._assetIndex = self.bgAssetLocked; return; } // 锁定时停在该张
                self._assetIndex = (self._assetIndex + 1) % self.bgAssets.length;
                var pre = new Image();
                pre.src = self.bgAssets[(self._assetIndex + 1) % self.bgAssets.length];
                show(self.bgAssets[self._assetIndex]);
            }, this.bgAssetInterval || BG_ASSET_INTERVAL_DEFAULT);
        }
        this._applyChatboxBg();
        this._updateAssetBar();
    },

    // 面板素材模式设置入口
    // v32: ①'lock-N' 点选锁定 / 'unlock' 解锁 ②自定义池(bgAssetsCustom)不被切模式整体覆盖【反驳③】
    setAssetBg: function (mode) {
        var self = this;
        if (mode === 'off') { this.bgAssets = null; this.bgAssetMode = ''; this.bgAssetsCustom = null; this.bgAssetLocked = null; this._assetIndex = 0; }
        else if (mode && mode.indexOf('lock-') === 0) {
            var li = parseInt(mode.slice(5), 10);
            if (!this.bgAssets || li >= this.bgAssets.length) return;
            this.bgAssetLocked = li;
            this._assetIndex = li;
            this.save();
            this._applyAssetBg(); // 立即切到该素材
            this._updateAssetBar();
            return;
        }
        else if (mode === 'unlock') {
            this.bgAssetLocked = null;
            this.save();
            this._applyAssetBg(); // v33: 重启引擎——旧实现只刷新点选条，解锁后仍是锁定时的 loop=true 单视频循环，轮播不再前进
            this._updateAssetBar();
            return;
        }
        else {
            this._scanAssets(function () {
                var pool = (mode === 'video') ? self._vidList : self._imgList;
                if (!pool || !pool.length) { self._assetToast('该模式无可用素材（扫描失败或目录为空）'); self._updateAssetBar(); return; }
                // 反驳③修复：用户自定义池存在时不整体覆盖；同模式重按仅刷新引擎
                var isCustom = self.bgAssetsCustom && self.bgAssetsCustom.length;
                if (!isCustom) { self.bgAssets = pool.slice(); self.bgAssetLocked = null; self._assetIndex = 0; }
                self.bgAssetMode = mode;
                self._assetIndex = self.bgAssetLocked || 0;
                self.save(); self.apply();
            });
            this._updateAssetBar();
            return;
        }
        this.save(); this.apply(); this._updateAssetBar();
    },

    // S2: 指定任意图片 URL（多选逗号/换行分隔），构建自定义池；失败张数 toast 兜底【反驳⑧】
    setAssetUrl: function (urls) {
        var self = this;
        var list = (urls || '').split(/[\n,]+/).map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 4; });
        if (!list.length) { this._assetToast('请先粘贴图片直链（http/https，多张用逗号/换行分隔）'); return; }
        var ok = 0, done = 0;
        list.forEach(function (u) {
            var im = new Image();
            im.onload = function () { ok++; fin(); };
            im.onerror = function () { fin(); };
            im.src = u;
        });
        setTimeout(function () { fin(true); }, 8000); // 8s 超时兜底
        function fin(timeout) {
            done++;
            if (done < list.length && !timeout) return;
            if (!ok) { self._assetToast('图片地址均不可加载（可能防盗链/CORS），已放弃'); return; }
            self.bgAssetsCustom = list.slice();
            self.bgAssets = list.slice();
            self.bgAssetMode = 'image';
            self.bgAssetLocked = null;
            self._assetIndex = 0;
            self.save(); self.apply(); self._updateAssetBar();
            if (ok < list.length) self._assetToast('部分图片不可加载，已加载 ' + ok + '/' + list.length + ' 张');
        }
    },

    // 【收口整改】模式条选中态刷新（修“切换后高亮不更新须重开面板”）：统一用 .active 类
    _updateAssetBar: function () {
        var bar = this._assetBarEl || document.getElementById('bgAssetBar');
        if (!bar) return;
        var cur = this.bgAssetMode || 'off';
        Array.prototype.forEach.call(bar.querySelectorAll('.bg-asset-btn'), function (b) {
            b.classList.toggle('active', b.getAttribute('data-asset') === cur);
        });
        var vr = bar.querySelector('#bgVeilRange');
        if (vr) { vr.value = Math.round((this.bgVeil || 0.5) * 100); var vv = bar.querySelector('#bgVeilVal'); if (vv) vv.textContent = vr.value + '%'; }
        var ir = bar.querySelector('#bgAssetItvRange');
        if (ir) { ir.value = Math.round((this.bgAssetInterval || BG_ASSET_INTERVAL_DEFAULT) / 1000); var iv = bar.querySelector('#bgAssetItvVal'); if (iv) iv.textContent = ir.value + 's'; }
        // v33: 视频模式下间隔语义=最短停留时长（视频播完整遍才切，绝不中途掐断）
        var il = bar.querySelector('#bgAssetItvLabel');
        if (il) il.textContent = (this.bgAssetMode === 'video') ? '轮播间隔(播完才切)' : '轮播间隔';
        var bc = bar.querySelector('#bgAssetBlendChk'); if (bc) bc.checked = !!this.bgAssetBlend;
        var cbr = bar.querySelector('#bgChatboxBgRange');
        if (cbr) { cbr.value = Math.round((typeof this.chatboxOpacity === 'number' ? this.chatboxOpacity : CHATBOX_OPACITY_DEFAULT) * 100); var cvv = bar.querySelector('#bgChatboxBgVal'); if (cvv) cvv.textContent = cbr.value === '0' ? '关闭' : cbr.value + '%'; }
        this._renderPickRow(bar);
    },

    // v32 S2/S3: 素材点选条渲染（点击缩略图=锁定该素材，再次点击=解锁恢复轮播）
    _renderPickRow: function (bar) {
        var self = this;
        var row = bar.querySelector('#bgAssetPickRow');
        if (!row) return;
        row.innerHTML = '';
        if (!this.bgAssets || !this.bgAssets.length) return;
        this.bgAssets.slice(0, 30).forEach(function (u, i) {
            var locked = (self.bgAssetLocked === i);
            // 修：轮播未锁定时也标出"当前正在播放"的素材，否则看不出轮到了哪张
            var isCurrent = locked || (self.bgAssetLocked == null && i === (self._assetIndex || 0));
            var item = document.createElement('div');
            var isVid = self.bgAssetMode === 'video';
            item.style.cssText = 'width:64px;height:44px;border-radius:6px;border:2px solid ' + (locked ? '#4a9eff' : (isCurrent ? 'rgba(74,158,255,.75)' : 'rgba(128,128,128,.35)')) + (isCurrent && !locked ? ';box-shadow:0 0 8px rgba(74,158,255,.45)' : '') + ';cursor:pointer;background-size:cover;background-position:center;position:relative;overflow:hidden;flex:0 0 auto';
            if (isVid) {
                item.textContent = '▶ ' + (i + 1);
                item.style.background = 'rgba(128,128,128,.18)';
                item.style.color = 'inherit';
                item.style.display = 'flex';
                item.style.alignItems = 'center';
                item.style.justifyContent = 'center';
            } else {
                item.style.backgroundImage = 'url("' + u.replace(/"/g, '\\"') + '")';
            }
            if (locked) {
                var tag = document.createElement('span');
                tag.textContent = '已锁定';
            } else if (isCurrent) {
                var tag = document.createElement('span');
                tag.textContent = '播放中';
            }
            if (tag) {
                tag.style.cssText = 'position:absolute;bottom:0;left:0;right:0;font-size:9px;text-align:center;background:' + (locked ? 'rgba(74,158,255,.85)' : 'rgba(74,158,255,.55)') + ';color:#fff;padding:1px 0';
                item.appendChild(tag);
            }
            item.title = (locked ? '点击解锁恢复轮播' : '点击锁定为当前背景') + '（' + (i + 1) + '）' + (isCurrent && !locked ? '｜当前正在播放' : '');
            item.addEventListener('click', function () {
                self.setAssetBg(locked ? 'unlock' : 'lock-' + i);
            });
            row.appendChild(item);
        });
    },

    // v32 S5: 对话框背景（CSS 变量 --chatboxBg 驱动，等比 cover，零 JS 耦合【突破④】）
    _applyChatboxBg: function () {
        var el = document.getElementById('bgAssetLayer');
        var cur = null;
        if (el && el.style.display !== 'none') {
            // 【修】不再依赖属性选择器匹配 style 串（cssText 序列化后 background:url 带空格会失配）：
            // 直接遍历子元素读 computed backgroundImage（图片层）；视频层读 video.src
            var divs = el.querySelectorAll('div');
            for (var i = divs.length - 1; i >= 0; i--) {
                var bi = divs[i].style.backgroundImage || getComputedStyle(divs[i]).backgroundImage;
                if (bi && bi !== 'none') {
                    var m = /url\(["']?(.*?)["']?\)/.exec(bi);
                    if (m && m[1]) { cur = m[1]; break; }
                }
            }
            var v = el.querySelector('video');
            if (!cur && v) cur = v.getAttribute('src') || v.src || null;
        }
        var op = (typeof this.chatboxOpacity === 'number') ? this.chatboxOpacity : CHATBOX_OPACITY_DEFAULT;
        var on = op > 0 && !!cur;
        document.body.classList.toggle('bg-chatbox-wallpaper', on);
        // 【2026-11-22】壁纸层已移除，透明度滑块现在只控制对话框底色半透明（与素材有无解耦，始终生效）
        document.body.classList.toggle('bg-chatbox-translucent', op > 0 && op < 1);
        document.body.style.setProperty('--chatboxBgOpacity', String(op));
    },

    _applyFx: function () {
        var self = this;
        var fxLayer = this._fxLayer || document.getElementById('bgFxLayer');
        if (!fxLayer) return;
        self._setupParallax();
        fxLayer.className = 'bg-fx-layer';
        // 清理ȫ部子层 / 计ʱ器 / canvas
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
            // 星空：静态闪烁星□?
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
            // □□□□□□□□canvas 绘制□□□ _startMouseFx
            this._startMouseFx(sub, fx);
        }
    },

    // v5.4.6: 多ѡ toggle（theme.js 面板调用），"无"Ϊ排他清空
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

    // ===== □□□□□□□canvas□?=====
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
            // resize 后将 netmouse ê点收回视口内，防ֹ回家力把节点拉到界外
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
                    hx: 0, hy: 0,   // 出生ê点，用于回家弹力
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
        var magicRot = 0;                    // magic ħ法阵旋ת角
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
                // 节点漂移 + 靠近鼠标被吸引
                for (var i = 0; nodes && i < nodes.length; i++) {
                    var n = nodes[i];
                    var dx = mouse.x - n.x, dy = mouse.y - n.y;
                    var d = Math.sqrt(dx * dx + dy * dy);
                    if (d < 220 && d > 1) { n.vx += dx / d * .03; n.vy += dy / d * .03; }
                    // 回家弹力：距ê点ԽԶ拉力Խǿ，防ֹ节点永久囤积在鼠标处
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
                // 连线：节点间 + 节点与鼠标
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
                // 鼠标光点
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
                    // 轨道虚线
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
                // 烟火：随机位□□□起爆炸，粒子散落
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
                // 科技□□□从底向上扩散的同心扫描波□?+ □□□□
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
                    // 二级波
                    ctx.beginPath();
                    ctx.arc(mouse.x, mouse.y, wv.r * 0.72, 0, 6.28);
                    ctx.strokeStyle = 'rgba(120,255,220,' + (wv.life * 0.2) + ')';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
                // 鼠标处雷达十字 + 光点
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
                // ħ法阵：跟随鼠标的旋ת符文阵，缓慢ת动 + 呼吸发光
                magicRot += 0.006;
                var mx = mouse.x, my = mouse.y;
                var pulse = 1 + Math.sin(Date.now() / 500) * 0.08;
                var R = 60 * pulse;
                // 外Ȧ˫环
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
                // 内接六â星（两个三角形，反向旋ת）
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
                // 灵光精灵：һȺ发光С精灵，Χ绕鼠标游߮，靠近ʱ被吸引
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
                    // 拖β΢光
                    ctx.beginPath();
                    ctx.arc(wx - Math.cos(wsp.a) * 5, wy - Math.sin(wsp.a * 1.3) * 4, 1.2, 0, 6.28);
                    ctx.fillStyle = 'hsla(' + wsp.hu + ',95%,80%,' + (flick * 0.4) + ')';
                    ctx.fill();
                }
            } else if (fx === 'vortex') {
                // 星漩：鼠标周Χ星尘被卷入漩涡旋ת
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
                    // ̫近则重生到Զ处
                    if (dist < 12) { d2.x = mouse.x + (Math.random() - .5) * W; d2.y = mouse.y + (Math.random() - .5) * H; }
                    // Խ界环绕
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
                // 秘法彗星：随机生成从鼠标λ置射出的ħ法彗星，带彩ɫ拖β
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
                    // ͷ部
                    ctx.beginPath();
                    ctx.arc(cm.x, cm.y, 3.2, 0, 6.28);
                    ctx.fillStyle = 'hsla(' + cm.hu + ',100%,80%,' + cm.life + ')';
                    ctx.shadowColor = 'hsla(' + cm.hu + ',100%,65%,.9)';
                    ctx.shadowBlur = 14; ctx.fill(); ctx.shadowBlur = 0;
                    // 拖β
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
            // ҳ面隐藏ʱ浏览器节流 setInterval/setTimeout（>=1s 甚至 1 分钟），
            // 移除定ʱ器被延迟 -> 子Ԫ素堆积超上限 -> spawn ȫ部 return，特Ч"ʱ间长了消ʧ"。
            if (document.hidden) return;
            if (fxLayer.children.length > max + 20) {
                // 超上限ʱ淘̭最老Ԫ素兜底，避免特Чͣ摆
                while (fxLayer.children.length > max && fxLayer.firstChild) {
                    fxLayer.removeChild(fxLayer.firstChild);
                }
            }
            var el = document.createElement('div');
            el.className = cls;
            styleFn(el);
            fxLayer.appendChild(el);
            if (window.Perf && _pf0) Perf.mark('背景:spawn-' + cls, _pf0);
            // 按Ԫ素自身动画ʱ长移除（修复：ԭ固定 55s 才移除，infinite 动画导致
            // children 堆积超过 max+20 上限后 spawn ֱ接 return，特Ч"开ʼ有后来消ʧ"）
            var dur = parseFloat(el.style.animationDuration);
            if (!dur || dur <= 0 || !isFinite(dur)) {
                try { dur = parseFloat(getComputedStyle(el).animationDuration) || 0; } catch (e) { dur = 0; }
            }
            // 仅有限动画按动画ʱ长移除；infinite 动画靠上面超限淘̭兜底
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

        // v30: 背景ͼƬģʽ已移除，永Զ纯ɫ
        var mDef = q('bgModeDefault'), mColor = q('bgModeColor'), mImg = q('bgModeImage');
        if (mDef) mDef.addEventListener('click', function () { self.mode = 'color'; self.save(); self.apply(); });
        if (mColor) mColor.addEventListener('click', function () { self.mode = 'color'; self.save(); self.apply(); });

        // 背景方案卡Ƭ
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

        // ===== v31 素材动态背景模式条（纯色关 / 图片轮播 / 视频）【收口整改版】=====
        // 整改：①小节标题（信息层级）②样式迁 style.css（单轨样式/主题适配）
        // ③选中态 .active 与方案卡统一 ④抽 _updateAssetBar 供 setAssetBg/_updateUI 动态刷新
        var assetBar = document.createElement('div');
        assetBar.id = 'bgAssetBar';
        assetBar.style.cssText = 'display:flex;gap:8px;margin:10px 0;flex-wrap:wrap;align-items:center';
        var title = document.createElement('div');
        title.textContent = '素材背景（动态壁纸）';
        title.style.cssText = 'font-size:12px;opacity:.75;margin:4px 0;flex:1 1 100%';
        assetBar.appendChild(title);
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;flex:1 1 100%';
        var modes = [
            { k: 'off',   label: '🎨 纯色' },
            { k: 'image', label: '🖼 图片轮播' },
            { k: 'video', label: '🎬 视频' }
        ];
        modes.forEach(function (m) {
            var b = document.createElement('button');
            b.className = 'bg-asset-btn';
            b.setAttribute('data-asset', m.k);
            b.textContent = m.label;
            b.addEventListener('click', function () { self.setAssetBg(m.k); });
            row.appendChild(b);
        });
        assetBar.appendChild(row);
        // veil 蒙版强度滑条（0~1，持久化 bgVeil；修复“默认0.8过重且无 UI 调节”）
        var veilRow = document.createElement('div');
        veilRow.style.cssText = 'display:flex;gap:8px;align-items:center;flex:1 1 100%;font-size:12px;opacity:.85';
        veilRow.innerHTML = '<span>蒙版强度</span><input id="bgVeilRange" type="range" min="0" max="100" step="5" style="flex:1;cursor:pointer"><span id="bgVeilVal"></span>';
        assetBar.appendChild(veilRow);
        var vr = veilRow.querySelector('#bgVeilRange');
        vr.value = Math.round((self.bgVeil || 0.5) * 100);
        veilRow.querySelector('#bgVeilVal').textContent = vr.value + '%';
        vr.addEventListener('input', function () {
            self.bgVeil = Number(vr.value) / 100;
            veilRow.querySelector('#bgVeilVal').textContent = vr.value + '%';
            self._applyVeil(); self.save();
        });
        // ===== v32 S1: 轮播间隔滑杆（3s~120s） =====
        var itvRow = document.createElement('div');
        itvRow.style.cssText = 'display:flex;gap:8px;align-items:center;flex:1 1 100%;font-size:12px;opacity:.85';
        itvRow.innerHTML = '<span id="bgAssetItvLabel">轮播间隔</span><input id="bgAssetItvRange" type="range" min="3" max="120" step="1" style="flex:1;cursor:pointer"><span id="bgAssetItvVal"></span>';
        assetBar.appendChild(itvRow);
        var ir = itvRow.querySelector('#bgAssetItvRange');
        ir.value = Math.round((self.bgAssetInterval || BG_ASSET_INTERVAL_DEFAULT) / 1000);
        itvRow.querySelector('#bgAssetItvVal').textContent = ir.value + 's';
        ir.addEventListener('input', function () {
            self.bgAssetInterval = Number(ir.value) * 1000;
            itvRow.querySelector('#bgAssetItvVal').textContent = ir.value + 's';
            self.save();
            if (self.bgAssetMode) self._applyAssetBg(); // 用新间隔重启引擎
        });
        // ===== v32 S5: 对话框背景透明度滑块（背景透过，文字不受影响） =====
        var cbRow = document.createElement('div');
        cbRow.style.cssText = 'display:flex;gap:8px;align-items:center;flex:1 1 100%;font-size:12px;opacity:.85';
        cbRow.innerHTML = '<label for="bgChatboxBgRange" title="滑块控制对话框壁纸层的实度：值越大背景越实，0 为关闭。文字始终不受影响" style="cursor:pointer;display:flex;gap:6px;align-items:center;flex:1 1 auto;white-space:nowrap">对话框透明度</label><input id="bgChatboxBgRange" type="range" min="0" max="100" step="5" style="flex:1 1 120px;min-width:100px;min-height:20px;cursor:pointer"><span id="bgChatboxBgVal" style="flex:0 0 36px;text-align:right"></span>';
        assetBar.appendChild(cbRow);
        var cr = cbRow.querySelector('#bgChatboxBgRange');
        var cv = cbRow.querySelector('#bgChatboxBgVal');
        cr.value = Math.round((typeof self.chatboxOpacity === 'number' ? self.chatboxOpacity : CHATBOX_OPACITY_DEFAULT) * 100);
        cv.textContent = cr.value === '0' ? '关闭' : cr.value + '%';
        cr.addEventListener('input', function () {
            self.chatboxOpacity = Number(cr.value) / 100;
            self.chatboxBg = self.chatboxOpacity > 0; // 兼容旧开关逻辑：>0 即启用壁纸
            cv.textContent = cr.value === '0' ? '关闭' : cr.value + '%';
            self._applyChatboxBg(); self.save();
        });

        // ===== v32 S3: 素材点选条（缩略图/名条，点选即锁定切换） =====
        var pickRow = document.createElement('div');
        pickRow.id = 'bgAssetPickRow';
        pickRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;flex:1 1 100%;font-size:12px;max-height:120px;overflow:auto';
        assetBar.appendChild(pickRow);
        // 插到主题面板 body 的最末尾【整改：需滚轮滚到底部才能看到，不再固定插在背景颜色区块后】
        var anchor = (grid && grid.closest) ? grid.closest('.theme-panel-body') : null;
        if (anchor) { anchor.appendChild(assetBar); }
        else { (document.getElementById('bgPanel') || document.body).appendChild(assetBar); }
        this._assetBarEl = assetBar;
        this._updateAssetBar();
        }

        // v30: 图片模式已移除，相关死代码（原 L974-1003 注释块）已删【收口整改】

        // 特Ч按ť：theme.js setupFxGrid 已ͳһ绑定（v5.4.7）——此处不再重复绑定，
        // 否则ͬһ按ť两个监听器都调 toggleFx，点һ下 = toggle 两次 = ״̬ԭ样，表现Ϊ"点不动"
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

    // ===== ͬ步面板高亮 =====
    _updateUI: function () {
        var q = function (id) { return document.getElementById(id); };
        var map = { color: 'bgModeColor' }; // v30: ͼƬ按ť已移除
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
        this._updateAssetBar(); // 【收口整改】面板打开时同步素材模式条选中态
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
        // 清除ɫ块ѡ中高亮
        Array.prototype.forEach.call(document.querySelectorAll('#bgSchemeGrid .bg-scheme-card'), function (c) { c.classList.remove('active'); });
        // 【收口整改】重置时同步清空素材背景并停引擎（修“重置后视频/轮播仍在播”）
        this.bgAssets = null;
        this.bgAssetMode = '';
        this.bgVeil = 0.5;
        this.bgAssetsCustom = null;
        this.bgAssetLocked = null;
        this._assetIndex = 0;
        this._stopAssetEngine();
        Array.prototype.forEach.call(document.querySelectorAll('#bgAssetBar .bg-asset-btn'), function (b) {
            b.classList.toggle('active', b.getAttribute('data-asset') === 'off');
        });
        this.save();
        this.apply();
    }
};

// ҳ面就绪后初ʼ化
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { Background.init(); });
} else {
    Background.init();
}
