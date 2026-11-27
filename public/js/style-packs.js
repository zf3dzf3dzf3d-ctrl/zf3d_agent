// ========== style-packs.js v1 - AI 图标工坊·风格包引擎（P1） ==========
// 职责：
//   1. StylePack JSON schema 强校验（防 XSS：所有字段白名单，无 innerHTML 注入点）
//   2. 风格包注册：把包转换为 theme.js STYLES 对象并 push（面板宫格自动可渲染）
//   3. 内置扩展包：水墨、像素（墨黑 inkblack / 赛博朋克 neoncyber 已在 theme.js 内置）
//   4. 用户自定义包持久化（localStorage zf_style_packs），启动时自动恢复
// 依赖：theme.js 的全局 Theme 对象（注册须在 theme.js 加载之后）
// 令牌：vars 七色（bg/card/hover/border/text/text2/accent）→ 由 theme.js apply()
//       映射为全站 --bg/--bg-card/--blue/--text 等 + --zf-* 系列，全局无刷新热替换
//
// StylePack JSON schema v1：
// {
//   "format": "zf-style-pack",          // 必填，固定值
//   "version": 1,                        // 必填，数字
//   "id": "inkwash",                     // 必填，/^[a-z0-9-]{2,32}$/，不得与内置重复
//   "name": "水墨山水",                   // 必填，<=20 字
//   "mode": "dark",                      // 可选 dark|light，缺省按 bg 亮度自动判
//   "icons": { ... },                    // 可选（P2 图标生成填充），本引擎只透传不解析
//   "vars": {                            // 必填，七色全部必填
//     "bg": "#0f1114", "card": "#171a20", "hover": "#1d2129",
//     "border": "#2a2f38", "text": "#d8dde4", "text2": "#7a828e",
//     "accent": "#7fb8d8"                // 均须 ^#[0-9a-fA-F]{6}$ 或合法 rgba()
//   },
//   "extra": { "--radius": "10px", ... } // 可选，key 须 ^--[a-z0-9-]{1,40}$，value 纯文本
//   "extraCss": "..."                    // 可选，<=20000 字符；仅追加到 #zf-style-extra
//                                        //   （该 style 标签由 theme.js 整体替换管理，
//                                        //    内容不做白名单过滤，但来源仅限本地用户
//                                        //    自行导入的包，等同用户自写 CSS 权限；
//                                        //    分享导入场景 P2 再加 CSS 消毒）
// }

(function () {
    'use strict';

    var LS_KEY = 'zf_style_packs';
    var ID_RE = /^[a-z0-9-]{2,32}$/;
    var VAR_KEY_RE = /^--[a-z0-9-]{1,40}$/;
    var COLOR_RE = /^(#[0-9a-fA-F]{6}|rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(0|1|0?\.\d+)\s*\))$/;

    /* ===== 内置扩展包：水墨 / 像素（墨黑、赛博朋克已内置于 theme.js） ===== */
    var BUILTIN_PACKS = [
        {
            format: 'zf-style-pack', version: 1,
            id: 'inkwash', name: '水墨山水', mode: 'dark',
            vars: { bg: '#12141a', card: '#1a1e26', hover: '#20242e', border: '#323845',
                    text: '#dfe3ea', text2: '#8a92a0', accent: '#9db8cc' },
            extra: { '--radius': '6px', '--green': '#9db8cc', '--blue-rgb': '157, 184, 204' },
            extraCss: '.zf-style-glow body:not(:has(#bgCustomLayer)) { background: linear-gradient(170deg,#161a22 0%,#10131a 55%,#0c0f15 100%) !important; }' +
                ' .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background: linear-gradient(180deg,rgba(26,30,38,0.78),rgba(20,24,33,0.78)) !important; border:1px solid #323845 !important; box-shadow: 0 4px 18px rgba(0,0,0,.35), inset 0 1px 0 rgba(157,184,204,.08) !important; border-radius:6px !important; }' +
                ' .zf-style-glow .card { background:rgba(26,30,38,0.78) !important; border:1px solid #2a2f38 !important; border-radius:6px !important; }' +
                ' .zf-style-glow .card:hover { border-color:#9db8cc !important; box-shadow:0 0 14px rgba(157,184,204,.18) !important; }' +
                ' .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { color:#e6eaf1 !important; font-weight:400; letter-spacing:.04em; text-shadow:none; }' +
                ' .zf-style-glow button, .zf-style-glow .btn { background:linear-gradient(180deg,rgba(36,42,52,0.8),rgba(28,33,42,0.8)) !important; color:#dfe3ea !important; border:1px solid #3a4150 !important; border-radius:4px !important; font-weight:400; }' +
                ' .zf-style-glow button:hover, .zf-style-glow .btn:hover { border-color:#9db8cc !important; color:#fff !important; }' +
                ' .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background:rgba(18,21,28,0.8) !important; border:1px solid #2e3440 !important; color:#dfe3ea !important; border-radius:4px !important; }' +
                ' .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color:#9db8cc !important; }' +
                ' .zf-style-glow a { color:#a9c2d6; } .zf-style-glow ::selection { background:#33415a; color:#eef2f7; }' +
                ' .zf-style-glow .status-dot.status-active { background:rgba(157,184,204,0.78) !important; }' +
                ' .zf-style-glow .chatbox{background:transparent!important}'
        },
        {
            format: 'zf-style-pack', version: 1,
            id: 'pixelart', name: '像素复古', mode: 'dark',
            vars: { bg: '#141018', card: '#1e1826', hover: '#262030', border: '#3d2f4d',
                    text: '#e8e2d8', text2: '#9a8fa8', accent: '#f2b135' },
            extra: { '--radius': '0px', '--green': '#7fd67f', '--blue-rgb': '242, 177, 53' },
            extraCss: '.zf-style-glow * { border-radius: 0 !important; font-family: "Courier New", Consolas, monospace; }' +
                ' .zf-style-glow body:not(:has(#bgCustomLayer)) { background: #141018 !important; }' +
                ' .zf-style-glow .panel, .zf-style-glow [class*="panel"]:not(.mo-panel):not(.mo-panel *) { background:rgba(30,24,38,0.78) !important; border:3px solid #3d2f4d !important; box-shadow: 6px 6px 0 rgba(0,0,0,.5) !important; }' +
                ' .zf-style-glow .card { background:rgba(30,24,38,0.78) !important; border:2px solid #3d2f4d !important; box-shadow: 4px 4px 0 rgba(0,0,0,.4); }' +
                ' .zf-style-glow .card:hover { border-color:#f2b135 !important; box-shadow: 4px 4px 0 rgba(242,177,53,.4); }' +
                ' .zf-style-glow button, .zf-style-glow .btn { background:rgba(242,177,53,0.8) !important; color:#1a1420 !important; border:2px solid #1a1420 !important; box-shadow: 3px 3px 0 #1a1420 !important; font-weight:700; text-transform:uppercase; letter-spacing:.06em; }' +
                ' .zf-style-glow button:hover, .zf-style-glow .btn:hover { filter:brightness(1.12); transform:translate(-1px,-1px); box-shadow: 4px 4px 0 #1a1420 !important; }' +
                ' .zf-style-glow input, .zf-style-glow textarea, .zf-style-glow select { background:rgba(23,18,32,0.8) !important; border:2px solid #3d2f4d !important; color:#e8e2d8 !important; }' +
                ' .zf-style-glow input:focus, .zf-style-glow textarea:focus { border-color:#f2b135 !important; outline:2px solid #f2b135; outline-offset:1px; }' +
                ' .zf-style-glow h1, .zf-style-glow h2, .zf-style-glow h3 { color:#f2b135 !important; text-shadow: 2px 2px 0 rgba(0,0,0,.6); letter-spacing:.08em; }' +
                ' .zf-style-glow a { color:#f2b135; } .zf-style-glow ::selection { background:#f2b135; color:#1a1420; }' +
                ' .zf-style-glow .status-dot.status-active { background:rgba(127,214,127,0.78) !important; }' +
                ' .zf-style-glow .chatbox{background:transparent!important}'
        }
    ];

    /* ===== schema 校验：返回 {ok, errors:[], pack} ===== */
    function validate(pack) {
        var errs = [];
        if (!pack || typeof pack !== 'object' || Array.isArray(pack)) return { ok: false, errors: ['不是有效的 JSON 对象'] };
        if (pack.format !== 'zf-style-pack') errs.push('format 必须为 "zf-style-pack"');
        if (typeof pack.version !== 'number') errs.push('version 必须为数字');
        if (typeof pack.id !== 'string' || !ID_RE.test(pack.id)) errs.push('id 须为 2-32 位小写字母/数字/连字符');
        if (typeof pack.name !== 'string' || !pack.name.trim() || pack.name.length > 20) errs.push('name 必填且 ≤20 字');
        if (pack.mode && pack.mode !== 'dark' && pack.mode !== 'light') errs.push('mode 只能为 dark|light');
        var v = pack.vars;
        if (!v || typeof v !== 'object') { errs.push('vars 缺失'); }
        else {
            ['bg', 'card', 'hover', 'border', 'text', 'text2', 'accent'].forEach(function (k) {
                if (typeof v[k] !== 'string' || !COLOR_RE.test(v[k].trim())) errs.push('vars.' + k + ' 非法色值');
            });
            if (Object.keys(v).length > 24) errs.push('vars 字段过多');
        }
        if (pack.extra) {
            if (typeof pack.extra !== 'object' || Array.isArray(pack.extra)) errs.push('extra 须为对象');
            else {
                var ks = Object.keys(pack.extra);
                if (ks.length > 24) errs.push('extra 字段过多');
                ks.forEach(function (k) {
                    if (!VAR_KEY_RE.test(k)) errs.push('extra.' + k + ' 非法变量名（须 -- 开头）');
                    else if (typeof pack.extra[k] !== 'string' || pack.extra[k].length > 200) errs.push('extra.' + k + ' 值过长');
                });
            }
        }
        if (pack.extraCss != null && (typeof pack.extraCss !== 'string' || pack.extraCss.length > 20000)) errs.push('extraCss 须为 ≤20000 字符的字符串');
        if (errs.length) return { ok: false, errors: errs };
        return { ok: true, errors: [], pack: pack };
    }

    /* ===== 包 → theme.js STYLES 风格对象 ===== */
    function toStyleObject(pack) {
        return {
            id: pack.id, name: pack.name,
            mode: pack.mode || 'dark',
            bg: pack.vars.bg, fx: 'none',
            vars: {
                bg: pack.vars.bg, card: pack.vars.card, hover: pack.vars.hover,
                border: pack.vars.border, text: pack.vars.text, text2: pack.vars.text2,
                accent: pack.vars.accent
            },
            extra: pack.extra || {},
            extraCss: pack.extraCss || '',
            _fromPack: true
        };
    }

    /* ===== 注册：push 进 Theme.styles（面板宫格数据源，同一数组引用） ===== */
    function register(pack) {
        var chk = validate(pack);
        if (!chk.ok) return chk;
        var styles = window.Theme && window.Theme.styles;
        if (!styles) return { ok: false, errors: ['Theme 未加载'] };
        // 同 id 已存在（内置或先前注册）→ 先移除再注册（幂等覆盖）
        for (var i = styles.length - 1; i >= 0; i--) if (styles[i].id === pack.id) styles.splice(i, 1);
        styles.push(toStyleObject(pack));
        return { ok: true, errors: [] };
    }

    /* ===== 用户包持久化 ===== */
    function loadUserPacks() {
        try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; }
    }
    function saveUserPacks(list) {
        try { localStorage.setItem(LS_KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
    }
    function upsertUserPack(pack) {
        var list = loadUserPacks();
        var found = false;
        for (var i = 0; i < list.length; i++) if (list[i].id === pack.id) { list[i] = pack; found = true; }
        if (!found) list.push(pack);
        return saveUserPacks(list);
    }
    function removeUserPack(id) {
        var list = loadUserPacks().filter(function (p) { return p.id !== id; });
        return saveUserPacks(list);
    }

    /* ===== 面板卡片补充渲染（内置宫格 grid.dataset.done 已跳过新卡，需自补） ===== */
    function addGridCard(pack, retry) {
        var grid = document.getElementById('zfStyleGrid');
        if (!grid) {
            // 面板 DOM 可能尚未注入（dom-theme-panel.js 异步注入），重试等待
            if ((retry || 0) < 40) setTimeout(function () { addGridCard(pack, (retry || 0) + 1); }, 250);
            return;
        }
        // 防重复
        if (grid.querySelector('[data-style="' + pack.id + '"]')) return;
        var s = toStyleObject(pack);
        var card = document.createElement('div');
        card.className = 'zf-style-card';
        card.setAttribute('data-style', s.id);
        card.innerHTML =
            '<div class="zs-preview" style="background:' + s.vars.bg + '">' +
                '<div class="zs-bar" style="background:' + s.vars.card + ';border:1px solid ' + s.vars.border + '"></div>' +
                '<div class="zs-dot" style="background:' + s.vars.accent + '"></div>' +
            '</div>' +
            '<div class="zs-name">' + s.name.replace(/[<>&]/g, '') + '</div>';
        card.addEventListener('click', function (e) {
            e.stopPropagation();
            window.Theme.setStyle(s.id);
        });
        grid.appendChild(card);
    }

    /* ===== 启动：注册内置扩展包 + 恢复用户包 ===== */
    function boot() {
        if (!window.Theme || !window.Theme.styles) {
            boot._tries = (boot._tries || 0) + 1;
            if (boot._tries < 100) setTimeout(boot, 200); // 上限 100 次（20s），防 Theme 永不加载时空转
            else console.warn('[style-packs] Theme 始终未加载，boot 放弃');
            return;
        }
        BUILTIN_PACKS.forEach(function (p) {
            var r = register(p);
            if (r.ok) { addGridCard(p); }
            else console.warn('[style-packs] 内置包注册失败', p.id, r.errors);
        });
        loadUserPacks().forEach(function (p) {
            var r = register(p);
            if (r.ok) addGridCard(p);
            else console.warn('[style-packs] 用户包恢复失败（已跳过）', p.id, r.errors);
        });
        // 启动日志已移除（降噪）
    }

    /* ===== 对外 API ===== */
    var AP = {
        validate: validate,
        register: register,           // 注册（不持久化），返回 {ok,errors}
        boot: boot,
        importPack: function (jsonStr) {
            var pack;
            try { pack = JSON.parse(jsonStr); } catch (e) { return { ok: false, errors: ['JSON 解析失败：' + e.message] }; }
            var r = register(pack);
            if (!r.ok) return r;
            if (!upsertUserPack(pack)) return { ok: false, errors: ['localStorage 写入失败'] };
            addGridCard(pack);
            return { ok: true, errors: [], id: pack.id };
        },
        removePack: function (id) {
            removeUserPack(id);
            var styles = window.Theme ? window.Theme.styles : [];
            for (var i = styles.length - 1; i >= 0; i--) if (styles[i].id === id && styles[i]._fromPack) styles.splice(i, 1);
            var card = document.querySelector('#zfStyleGrid [data-style="' + id + '"]');
            if (card) card.remove();
            return { ok: true };
        },
        list: function () { return loadUserPacks(); },
        builtins: BUILTIN_PACKS
    };
    window.StylePacks = AP;

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
