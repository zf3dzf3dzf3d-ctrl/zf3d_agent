/**
 * background.js - 画布背景管理器
 * 支持模式：default(默认星空) / color(纯色) / image(图片)
 * 特效：particles 粒子 / clouds 云 / bubbles 气泡 / aurora 极光 / sun 晴天
 * 配置持久化：localStorage zf_background + UserSettings 兼容
 */
var Background = {
    mode: 'default',        // default | color | image
    color: '#0a0e1a',
    colorStar: true,        // 纯色模式下是否叠加星空
    imageUrl: '',
    imageBlur: true,
    imageDark: true,
    fx: 'none',             // none | particles | clouds | bubbles | aurora | sun

    _fxTimer: null,
    _fxLayer: null,

    // ===== 初始化 =====
    init: function () {
        var self = this;
        this._buildLayer();
        this.apply();
        this._setupUI();
        // 异步从服务器加载已保存的背景配置，到达后覆盖当前默认值
        this._loadFromServer(function (saved) {
            if (saved) {
                self.mode = saved.mode || 'default';
                self.color = saved.color || '#0a0e1a';
                self.colorStar = saved.colorStar !== false;
                self.imageUrl = saved.imageUrl || '';
                self.imageBlur = saved.imageBlur !== false;
                self.imageDark = saved.imageDark !== false;
                self.fx = saved.fx || 'none';
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
                colorStar: this.colorStar,
                imageUrl: this.imageUrl,
                imageBlur: this.imageBlur,
                imageDark: this.imageDark,
                fx: this.fx
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

    // ===== 应用背景 =====
    apply: function () {
        var layer = document.getElementById('bgCustomLayer');
        var body = document.body;
        if (!layer) return;

        // 先清理
        layer.style.background = '';
        layer.style.display = 'none';
        body.classList.remove('bg-star-off');

        if (this.mode === 'color') {
            layer.style.display = 'block';
            layer.style.background = this.color;
            // 纯色模式下关闭星空（除非勾选叠加）；特效选"无"时也强制关星空
            body.classList.toggle('bg-star-off', !this.colorStar || this.fx === 'none');
        } else if (this.mode === 'image' && this.imageUrl) {
            layer.style.display = 'block';
            layer.style.backgroundImage = 'url("' + this.imageUrl.replace(/"/g, '\\"') + '")';
            layer.style.backgroundSize = 'cover';
            layer.style.backgroundPosition = 'center';
            body.classList.toggle('bg-star-off', this.fx === 'none');
            body.classList.toggle('bg-image-blur', this.imageBlur);
            body.classList.toggle('bg-image-dark', this.imageDark);
        } else {
            body.classList.remove('bg-image-blur', 'bg-image-dark');
            // 默认模式下：特效选"无"时连星空也关闭
            body.classList.toggle('bg-star-off', this.fx === 'none');
        }

        // 隐藏/显示默认星空 canvas（特效选"无"时一律隐藏）
        var star = document.getElementById('starfield');
        if (star) star.style.display = this.fx === 'none' ? 'none' : '';

        this._applyFx();
        this._updateUI();
    },

    // ===== 特效 =====
    _applyFx: function () {
        var self = this;
        var fxLayer = this._fxLayer || document.getElementById('bgFxLayer');
        if (!fxLayer) return;
        fxLayer.className = 'bg-fx-layer';
        fxLayer.innerHTML = '';
        if (this._fxTimer) { clearInterval(this._fxTimer); this._fxTimer = null; }

        var fx = this.fx;
        if (fx === 'aurora') {
            fxLayer.classList.add('bg-fx-aurora');
            return;
        }
        if (fx === 'sun') {
            fxLayer.classList.add('bg-fx-sun');
            return;
        }
        if (fx === 'particles') {
            this._spawnTimer(fxLayer, 'bg-particle', 700, function (el) {
                el.style.left = Math.random() * 100 + '%';
                el.style.top = Math.random() * 100 + '%';
                var s = 2 + Math.random() * 3;
                el.style.width = s + 'px';
                el.style.height = s + 'px';
            }, 18);
        } else if (fx === 'clouds') {
            this._spawnTimer(fxLayer, 'bg-cloud', 6000, function (el) {
                el.style.top = 5 + Math.random() * 40 + '%';
                el.style.animationDuration = (40 + Math.random() * 40) + 's';
                var s = 0.6 + Math.random() * 1.2;
                el.style.transform = 'scale(' + s + ')';
            }, 6);
        } else if (fx === 'bubbles') {
            this._spawnTimer(fxLayer, 'bg-bubble', 500, function (el) {
                el.style.left = Math.random() * 100 + '%';
                var s = 4 + Math.random() * 12;
                el.style.width = s + 'px';
                el.style.height = s + 'px';
                el.style.animationDuration = (8 + Math.random() * 10) + 's';
            }, 14);
        }
    },

    _spawnTimer: function (fxLayer, cls, interval, styleFn, max) {
        var self = this;
        function spawn() {
            if (fxLayer.children.length > max + 20) return;
            var el = document.createElement('div');
            el.className = cls;
            styleFn(el);
            fxLayer.appendChild(el);
            setTimeout(function () {
                if (el.parentNode) el.parentNode.removeChild(el);
            }, 55000);
        }
        for (var i = 0; i < max; i++) spawn();
        this._fxTimer = setInterval(spawn, interval);
    },

    // ===== 面板 UI =====
    _setupUI: function () {
        var self = this;

        function q(id) { return document.getElementById(id); }

        var mDef = q('bgModeDefault'), mColor = q('bgModeColor'), mImg = q('bgModeImage');
        if (mDef) mDef.addEventListener('click', function () { self.mode = 'default'; self.save(); self.apply(); });
        if (mColor) mColor.addEventListener('click', function () { self.mode = 'color'; self.save(); self.apply(); });
        if (mImg) mImg.addEventListener('click', function () { self.mode = 'image'; self.save(); self.apply(); });

        var picker = q('bgColorPicker');
        if (picker) {
            picker.addEventListener('input', function () {
                self.color = this.value;
                q('bgColorValue').textContent = this.value.toUpperCase();
                self.save(); self.apply();
            });
        }
        // 预设色
        Array.prototype.forEach.call(document.querySelectorAll('.bg-preset'), function (el) {
            el.addEventListener('click', function () {
                self.color = el.getAttribute('data-bg-color');
                if (picker) picker.value = self.color;
                var v = q('bgColorValue'); if (v) v.textContent = self.color.toUpperCase();
                self.save(); self.apply();
            });
        });

        var starToggle = q('bgStarToggle');
        if (starToggle) starToggle.addEventListener('change', function () {
            self.colorStar = this.checked; self.save(); self.apply();
        });

        var urlInput = q('bgImageUrl');
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

        // 特效按钮
        Array.prototype.forEach.call(document.querySelectorAll('.bg-fx-btn'), function (el) {
            el.addEventListener('click', function () {
                self.fx = el.getAttribute('data-fx');
                self.save(); self.apply();
            });
        });
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
        var map = { default: 'bgModeDefault', color: 'bgModeColor', image: 'bgModeImage' };
        Object.keys(map).forEach(function (k) {
            var b = q(map[k]);
            if (b) b.classList.toggle('active', Background.mode === k);
        });
        var cp = q('bgColorPanel');
        if (cp) cp.style.display = this.mode === 'color' ? 'block' : 'none';
        var ip = q('bgImagePanel');
        if (ip) ip.style.display = this.mode === 'image' ? 'block' : 'none';
        var starToggle = q('bgStarToggle');
        if (starToggle) starToggle.checked = this.colorStar;
        var blurChk = q('bgImageBlur');
        if (blurChk) blurChk.checked = this.imageBlur;
        var darkChk = q('bgImageDark');
        if (darkChk) darkChk.checked = this.imageDark;
        Array.prototype.forEach.call(document.querySelectorAll('.bg-fx-btn'), function (el) {
            el.classList.toggle('active', el.getAttribute('data-fx') === Background.fx);
        });
        this._updatePreview();
    },

    // ===== 重置 =====
    reset: function () {
        this.mode = 'default';
        this.color = '#0a0e1a';
        this.colorStar = true;
        this.imageUrl = '';
        this.imageBlur = true;
        this.imageDark = true;
        this.fx = 'none';
        var urlInput = document.getElementById('bgImageUrl');
        if (urlInput) urlInput.value = '';
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
