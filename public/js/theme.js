// ========== theme.js - 日夜主题切换 + 色轮自定义 ==========
// 用户可选择一个主色调，系统自动派生全套配色，实时预览
// 单按钮点击弹出面板，面板内含「白天」和「黑夜」两个模式卡片

var Theme = {
    // 默认主色
    darkAccent: '#0984e3',
    lightAccent: '#0078d4',
    current: 'dark',

    // ===== 初始化 =====
    init: function() {
        // 检查 URL 参数 ?reset_theme=1，自动重置为默认颜色
        try {
            var params = new URLSearchParams(window.location.search);
            if (params.get('reset_theme') === '1') {
                UserSettings.remove('zf_theme');
                try { localStorage.removeItem('zf_theme'); } catch (e) {}
                this.darkAccent = '#0984e3';
                this.lightAccent = '#0078d4';
                this.current = 'dark';
                this.save();
                this.apply();
                this._setupUI();
                // 清除 URL 参数，避免每次刷新都重置
                window.history.replaceState({}, document.title, window.location.pathname);
                console.log('[Theme] 已重置为默认颜色');
                return;
            }
        } catch(e) {}

        var saved = this._load();
        if (saved) {
            this.darkAccent = saved.darkAccent || this.darkAccent;
            this.lightAccent = saved.lightAccent || this.lightAccent;
            this.current = saved.current || this.current;
        }
        this.apply();
        this._setupUI();
    },

    // ===== hex <-> HSL 转换 =====
    hexToHsl: function(hex) {
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
        var r = parseInt(hex.substr(0,2),16)/255;
        var g = parseInt(hex.substr(2,2),16)/255;
        var b = parseInt(hex.substr(4,2),16)/255;
        var max = Math.max(r,g,b), min = Math.min(r,g,b);
        var h, s, l = (max+min)/2;
        if (max === min) { h = s = 0; }
        else {
            var d = max - min;
            s = l > 0.5 ? d/(2-max-min) : d/(max+min);
            switch(max) {
                case r: h = (g-b)/d + (g<b?6:0); break;
                case g: h = (b-r)/d + 2; break;
                case b: h = (r-g)/d + 4; break;
            }
            h /= 6;
        }
        return { h: h*360, s: s*100, l: l*100 };
    },

    hslToHex: function(h, s, l) {
        h /= 360; s /= 100; l /= 100;
        var r, g, b;
        if (s === 0) { r = g = b = l; }
        else {
            var hue2rgb = function(p, q, t) {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q-p)*6*t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q-p)*(2/3-t)*6;
                return p;
            };
            var q = l < 0.5 ? l*(1+s) : l + s - l*s;
            var p = 2*l - q;
            r = hue2rgb(p, q, h+1/3);
            g = hue2rgb(p, q, h);
            b = hue2rgb(p, q, h-1/3);
        }
        var toHex = function(x) {
            var h = Math.round(x*255).toString(16);
            return h.length === 1 ? '0'+h : h;
        };
        return '#' + toHex(r) + toHex(g) + toHex(b);
    },

    // ===== hex to 'r, g, b' string for use in rgba() =====
    _hexToRgb: function(hex) {
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
        var r = parseInt(hex.substr(0,2),16);
        var g = parseInt(hex.substr(2,2),16);
        var b = parseInt(hex.substr(4,2),16);
        return r + ', ' + g + ', ' + b;
    },

    // ===== 暗色主题：从主色派生全套配色 =====
    generateDarkPalette: function(accentHex) {
        var hsl = this.hexToHsl(accentHex);
        var h = hsl.h, s = hsl.s;
        // 暗色：低明度背景 + 高明度文字
        var bgS = Math.min(s * 0.4, 25);
        return {
            '--bg':      this.hslToHex(h, bgS, 9),
            '--bg-card': this.hslToHex(h, bgS, 11),
            '--bg-hover':this.hslToHex(h, bgS, 16),
            '--border':  this.hslToHex(h, bgS * 0.8, 20),
            '--text':    this.hslToHex(h, 15, 94),
            '--text2':   this.hslToHex(h, 12, 62),
            '--blue':    accentHex,
            '--blue-rgb':this._hexToRgb(accentHex),
            '--green':   '#28a745'
        };
    },

    // ===== 亮色主题：从主色派生全套配色 =====
    generateLightPalette: function(accentHex) {
        var hsl = this.hexToHsl(accentHex);
        var h = hsl.h, s = hsl.s;
        // 亮色：高明度背景 + 低明度文字
        var bgS = Math.min(s * 0.25, 18);
        return {
            '--bg':      this.hslToHex(h, bgS, 93),
            '--bg-card': this.hslToHex(h, bgS, 97),
            '--bg-hover':this.hslToHex(h, bgS, 90),
            '--border':  this.hslToHex(h, bgS * 0.8, 82),
            '--text':    this.hslToHex(h, 20, 15),
            '--text2':   this.hslToHex(h, 12, 42),
            '--blue':    accentHex,
            '--blue-rgb':this._hexToRgb(accentHex),
            '--green':   '#1a8a3a'
        };
    },

    // ===== 应用主题到 DOM =====
    apply: function() {
        var palette = this.current === 'dark'
            ? this.generateDarkPalette(this.darkAccent)
            : this.generateLightPalette(this.lightAccent);

        var root = document.documentElement;
        Object.keys(palette).forEach(function(key) {
            root.style.setProperty(key, palette[key]);
        });

        // 设置 data-theme 属性（用于 CSS 覆盖硬编码颜色）
        root.setAttribute('data-theme', Theme.current);

        // 更新按钮图标
        var btn = document.getElementById('themeBtn');
        if (btn) {
            btn.textContent = Theme.current === 'dark' ? '\uD83C\uDF19' : '\u2600\uFE0F';
            btn.title = Theme.current === 'dark' ? '当前: 黑夜模式' : '当前: 白天模式';
        }

        // 更新面板内的高亮状态
        this._updateModeCards();
        this._updateSwatches();

        // dispatch event so other modules (minimap etc) can react
        try {
            document.dispatchEvent(new CustomEvent('themechange', { detail: { mode: this.current } }));
        } catch(e) {}
    },

    // ===== 切换主题 =====
    toggle: function() {
        this.current = this.current === 'dark' ? 'light' : 'dark';
        this.save();
        this.apply();
    },

    // ===== 设置模式 =====
    setMode: function(mode) {
        if (mode === this.current) return;
        this.current = mode;
        this.save();
        this.apply();
    },

    // ===== 设置暗色主色 =====
    setDarkAccent: function(hex) {
        this.darkAccent = hex;
        if (this.current === 'dark') this.apply();
        this.save();
    },

    // ===== 设置亮色主色 =====
    setLightAccent: function(hex) {
        this.lightAccent = hex;
        if (this.current === 'light') this.apply();
        this.save();
    },

    // ===== 保存 / 读取（private/用户设置/user_settings.json，localStorage 兼容备份） =====
    save: function() {
        try {
            var data = JSON.stringify({
                darkAccent: this.darkAccent,
                lightAccent: this.lightAccent,
                current: this.current
            });
            localStorage.setItem('zf_theme', data);
            try { UserSettings.set('zf_theme', data); } catch (e) {}
        } catch(e) {}
    },

    _load: function() {
        try {
            var s = null;
            try { s = UserSettings.get('zf_theme'); } catch (e) {}
            if (!s) s = localStorage.getItem('zf_theme');
            return s ? JSON.parse(s) : null;
        } catch(e) { return null; }
    },

    // ===== 更新模式卡片高亮 =====
    _updateModeCards: function() {
        var darkCard = document.getElementById('themeModeDark');
        var lightCard = document.getElementById('themeModeLight');
        if (darkCard) {
            darkCard.classList.toggle('active', this.current === 'dark');
        }
        if (lightCard) {
            lightCard.classList.toggle('active', this.current === 'light');
        }
    },

    // ===== 更新色块预览 =====
    _updateSwatches: function() {
        // 更新色值显示
        var darkVal = document.getElementById('themeDarkValue');
        if (darkVal) darkVal.textContent = this.darkAccent.toUpperCase();
        var lightVal = document.getElementById('themeLightValue');
        if (lightVal) lightVal.textContent = this.lightAccent.toUpperCase();

        // 更新 color input 值
        var darkInput = document.getElementById('themeDarkPicker');
        if (darkInput) darkInput.value = this.darkAccent;
        var lightInput = document.getElementById('themeLightPicker');
        if (lightInput) lightInput.value = this.lightAccent;

        // 更新预设色块选中态
        this._updatePresetSelection();
    },

    _updatePresetSelection: function() {
        var self = this;
        document.querySelectorAll('.theme-preset-color').forEach(function(el) {
            var hex = el.getAttribute('data-color');
            var target = el.getAttribute('data-target');
            var currentColor = target === 'dark' ? self.darkAccent : self.lightAccent;
            if (hex.toLowerCase() === currentColor.toLowerCase()) {
                el.classList.add('selected');
            } else {
                el.classList.remove('selected');
            }
        });
    },

    // ===== UI 事件绑定 =====
    _setupUI: function() {
        var self = this;

        // 单按钮：点击弹出面板
        var btn = document.getElementById('themeBtn');
        var panel = document.getElementById('themePanel');
        if (btn && panel) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                panel.classList.toggle('open');
            });
            // 点击面板外部关闭
            document.addEventListener('click', function(e) {
                if (!panel.contains(e.target) && e.target !== btn) {
                    panel.classList.remove('open');
                }
            });
        }

        // 暗色模式卡片点击 - 切换到暗色
        var darkCard = document.getElementById('themeModeDark');
        if (darkCard) {
            darkCard.addEventListener('click', function(e) {
                if (e.target.classList.contains('theme-preset-color') ||
                    e.target.classList.contains('theme-color-input') ||
                    e.target.id === 'themeDarkPicker' ||
                    e.target.id === 'themeDarkValue') return;
                self.setMode('dark');
            });
        }

        // 亮色模式卡片点击 - 切换到亮色
        var lightCard = document.getElementById('themeModeLight');
        if (lightCard) {
            lightCard.addEventListener('click', function(e) {
                if (e.target.classList.contains('theme-preset-color') ||
                    e.target.classList.contains('theme-color-input') ||
                    e.target.id === 'themeLightPicker' ||
                    e.target.id === 'themeLightValue') return;
                self.setMode('light');
            });
        }

        // 暗色 color picker - 实时
        var darkPicker = document.getElementById('themeDarkPicker');
        if (darkPicker) {
            darkPicker.addEventListener('input', function() {
                self.setDarkAccent(this.value);
            });
        }

        // 亮色 color picker - 实时
        var lightPicker = document.getElementById('themeLightPicker');
        if (lightPicker) {
            lightPicker.addEventListener('input', function() {
                self.setLightAccent(this.value);
            });
        }

        // 预设色块点击
        document.querySelectorAll('.theme-preset-color').forEach(function(el) {
            el.addEventListener('click', function(e) {
                e.stopPropagation();
                var hex = this.getAttribute('data-color');
                var target = this.getAttribute('data-target');
                if (target === 'dark') {
                    self.setDarkAccent(hex);
                    // 如果当前不是暗色模式，自动切换
                    if (self.current !== 'dark') {
                        self.setMode('dark');
                    }
                } else {
                    self.setLightAccent(hex);
                    if (self.current !== 'light') {
                        self.setMode('light');
                    }
                }
            });
        });
    },

    // ===== 重置为默认色 =====
    reset: function() {
        this.darkAccent = '#0984e3';
        this.lightAccent = '#0078d4';
        this.current = 'dark';
        this.save();
        this.apply();
    }
};
