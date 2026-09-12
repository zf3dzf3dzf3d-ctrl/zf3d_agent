// ==== 发送按钮图标主题系统 ====
// 用户可在设置面板选择发送/停止图标，含阿拉丁神灯主题（发送=神灯，停止=神灯烟雾）
(function () {
    var KEY = 'zf_send_icon_theme';

    // 图标 SVG 内容（fill 用 currentColor，与原按钮一致）
    var THEMES = {
        classic: {
            name: '经典',
            desc: '纸飞机 / 方块（默认）',
            send: '<line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>',
            stop: '<rect x="6" y="6" width="12" height="12" rx="2"></rect>'
        },
        aladdin: {
            name: '阿拉丁神灯',
            desc: '发送=神灯 ✨ 停止=神灯烟雾（正在施法）',
            send: '<path d="M4.6 13.8c0-2.9 3.1-4.7 7.4-4.7 2.1 0 4 .5 5.4 1.3.9-.6 1.7-1.5 2.1-2.5.15-.4.75-.35.85.05.35 1.5-.1 3.2-1.2 4.4.3.5.45 1 .45 1.5 0 2.6-3.2 4.3-7.6 4.3s-7.4-1.7-7.4-4.3z"/><path d="M12 7.4c.5-1.2 1.7-2 3-2h1.2c.4 0 .4.6 0 .6H15c-1 0-2 .7-2.3 1.7l-.7-.3z"/><path d="M4.2 12.2c-1.3.3-2.2 1.2-2.2 2.3 0 1.1.9 2 2.2 2.3l.4-.9c-.9-.2-1.5-.8-1.5-1.4s.6-1.2 1.5-1.4l-.4-.9z"/><circle cx="12" cy="8" r="1.3"/><g class="aladdin-fx"><path class="a-flame" d="M4.6 11.2c-1.1-1-1.2-2.6-.2-4 .2 1 .8 1.5 1.6 1.4-.5-1.4.1-2.6 1.3-3.3-.4 1.2.1 1.9.9 2.6.8.7 1.2 1.7.8 2.8-.5 1.3-1.5 1.9-2.7 1.9-.7 0-1.3-.5-1.7-1.4z"/><circle class="a-smoke" cx="6.5" cy="6" r="1.1"/><circle class="a-smoke" cx="8" cy="4.6" r=".9" style="animation-delay:.15s"/><circle class="a-smoke" cx="4.8" cy="4.4" r=".8" style="animation-delay:.3s"/></g>',
            stop: '<g class="aladdin-carpet"><path d="M4.6 15.2l9.6-8.6 5.4 4.7-9.6 8.6z"/><path d="M7.8 12.4l6.7 5.6" stroke="currentColor" stroke-width=".9" fill="none" opacity=".5"/><path d="M10.2 10.3l6.7 5.6" stroke="currentColor" stroke-width=".9" fill="none" opacity=".35"/><path d="M3.6 16.2l-1.7 1.2M4.8 17.8l-1.2 1.7M14.9 6.1l.4-2M16.8 7.3l1.3-1.6" stroke="currentColor" stroke-width="1" fill="none" stroke-linecap="round"/></g>'
        },
        rocket: {
            name: '火箭',
            desc: '发送=火箭 🚀 停止=流星尾焰',
            send: '<path d="M12 1.5c3.2 2 5.2 5.8 5.2 9.6l-1.9 2.4H8.7l-1.9-2.4c0-3.8 2-7.6 5.2-9.6z"/><circle cx="12" cy="9" r="1.7" opacity=".45"/><path d="M9.6 14.8h4.8L13 20.2c-.3 1.2-.7 2-1 2.4-.3-.4-.7-1.2-1-2.4l-1.4-5.4z"/><path d="M8.4 14.2c-1.6.3-2.9 1.4-3.6 3l2.3-.8c-.1-.7.3-1.5 1.3-2.2zM15.6 14.2c1 .7 1.4 1.5 1.3 2.2l2.3.8c-.7-1.6-2-2.7-3.6-3z"/>',
            stop: '<circle cx="15.5" cy="8.5" r="4.5"/><path d="M12.5 11.5L4 20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M12 13.5l-5 5.5" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round" opacity=".55"/>'
        },
        magic: {
            name: '魔法星星',
            desc: '发送=魔法杖 ✨ 停止=星光散落',
            send: '<path d="M3.2 20.8L13.6 10.4l1.5 1.5L4.7 22.3c-.4.4-1.1.4-1.5 0-.4-.4-.4-1.1 0-1.5z"/><path d="M17 2.5l1 2.2 2.2 1-2.2 1-1 2.2-1-2.2-2.2-1 2.2-1 1-2.2z"/><path d="M20.8 10.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6.6-1.4z"/><path d="M13.2 14.6l.5 1.1 1.1.5-1.1.5-.5 1.1-.5-1.1-1.1-.5 1.1-.5.5-1.1z"/>',
            stop: '<path d="M7 4l.8 1.8L9.6 6.6l-1.8.8L7 9.2l-.8-1.8L4.4 6.6l1.8-.8L7 4z"/><path d="M16.5 8l.9 2 2 .9-2 .9-.9 2-.9-2-2-.9 2-.9.9-2z"/><path d="M10.5 15l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8.8-1.7z"/><path d="M17.5 17.5l.5 1.1 1.1.5-1.1.5-.5 1.1-.5-1.1-1.1-.5 1.1-.5.5-1.1z"/>'
        }
    };

    var themeOrder = ['classic', 'aladdin', 'rocket', 'magic'];

    function getTheme() {
        var v = null;
        try { v = localStorage.getItem(KEY); } catch (e) {}
        return THEMES[v] ? v : 'aladdin';
    }

    function svgInner(iconEl, content) {
        if (!iconEl) return;
        // SVG 元素的 innerHTML 在部分浏览器/内核下静默失败（会导致图标消失），
        // 改用 XML 解析后逐个替换子节点，全环境可靠
        try {
            var doc = new DOMParser().parseFromString(
                '<svg xmlns="http://www.w3.org/2000/svg">' + content + '</svg>',
                'image/svg+xml');
            while (iconEl.firstChild) iconEl.removeChild(iconEl.firstChild);
            var kids = doc.documentElement.childNodes;
            for (var i = 0; i < kids.length; i++) {
                iconEl.appendChild(document.importNode(kids[i], true));
            }
        } catch (e) {
            iconEl.innerHTML = content; // 降级
        }
    }

    // 将主题应用到某个发送按钮（或全部）
    function applyToBtn(btn, themeKey) {
        var t = THEMES[themeKey || getTheme()];
        if (!btn || !t) return;
        var sending = btn.classList.contains('sending');
        var si = btn.querySelector('.send-icon');
        var st = btn.querySelector('.stop-icon');
        svgInner(si, t.send);
        svgInner(st, t.stop);
        if (si) si.style.display = sending ? 'none' : '';
        if (st) st.style.display = sending ? '' : 'none';
    }

    function applyAll(themeKey) {
        var btns = document.querySelectorAll('.send-btn');
        for (var i = 0; i < btns.length; i++) applyToBtn(btns[i], themeKey);
    }

    function setTheme(key) {
        if (!THEMES[key]) return;
        try { localStorage.setItem(KEY, key); } catch (e) {}
        applyAll(key);
        renderPicker();
        if (window.App && App.toast) App.toast('发送图标已切换为「' + THEMES[key].name + '」');
    }

    // 设置面板里的选择器 UI
    function renderPicker() {
        var wrap = document.getElementById('sendIconThemePicker');
        if (!wrap) return;
        var cur = getTheme();
        var html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;">';
        themeOrder.forEach(function (k) {
            var t = THEMES[k];
            var active = k === cur;
            html += '<button type="button" data-sit="' + k + '" title="' + (t.desc || t.name) + '"'
                + ' style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 8px;'
                + 'border-radius:10px;cursor:pointer;font-size:12px;color:var(--text,#eee);'
                + 'border:2px solid ' + (active ? 'var(--accent,#4f8cff)' : 'var(--border,rgba(255,255,255,.12))') + ';'
                + 'background:' + (active ? 'rgba(79,140,255,.12)' : 'rgba(255,255,255,.04)') + ';">'
                + '<span style="display:flex;gap:6px;align-items:center;">'
                + '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + t.send + '</svg>'
                + '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" stroke="none">' + t.stop + '</svg>'
                + '</span>'
                + '<span>' + t.name + '</span>'
                + (active ? '<span style="font-size:10px;color:var(--accent,#4f8cff);">✓ 当前</span>' : '')
                + '</button>';
        });
        html += '</div>';
        wrap.innerHTML = html;
        var bs = wrap.querySelectorAll('[data-sit]');
        for (var i = 0; i < bs.length; i++) {
            bs[i].addEventListener('click', function () { setTheme(this.getAttribute('data-sit')); });
        }
    }

    // 监听后续动态创建的对话框，自动应用主题
    var mo = new MutationObserver(function (muts) {
        var cur = getTheme();
        if (cur === 'classic') return; // classic 即原生图标，无需处理
        muts.forEach(function (m) {
            for (var i = 0; i < m.addedNodes.length; i++) {
                var n = m.addedNodes[i];
                if (!n.querySelectorAll) continue;
                if (n.matches && n.matches('.send-btn')) applyToBtn(n, cur);
                var btns = n.querySelectorAll('.send-btn');
                for (var j = 0; j < btns.length; j++) applyToBtn(btns[j], cur);
            }
        });
    });

    function boot() {
        // 施法动画样式（停止=烟雾脉动；神灯主题=喷火+冒烟+摇晃）
        if (!document.getElementById('sit-style')) {
            var st = document.createElement('style');
            st.id = 'sit-style';
            st.textContent = '.send-btn.sending .stop-icon{animation:sitCarpet 1.8s ease-in-out infinite;transform-origin:12px 13px;}'
                + '@keyframes sitCarpet{0%{transform:translateY(0) rotate(0deg);}25%{transform:translateY(-1.6px) rotate(-4deg);}50%{transform:translateY(-2.4px) rotate(0deg);}75%{transform:translateY(-1.2px) rotate(4deg);}100%{transform:translateY(0) rotate(0deg);}}'
                /* 平时隐藏神灯特效（火焰+烟雾） */
                + '.aladdin-fx{opacity:0;pointer-events:none;}'
                /* 发送瞬间：神灯摇晃 + 喷火冒烟 */
                + '.send-btn.zf-cast .aladdin-fx{opacity:1;}'
                + '.send-btn.zf-cast{animation:aladdinShake .9s ease-in-out;}'
                + '@keyframes aladdinShake{0%{transform:rotate(0);}15%{transform:rotate(-12deg);}30%{transform:rotate(10deg);}45%{transform:rotate(-8deg);}60%{transform:rotate(6deg);}75%{transform:rotate(-3deg);}100%{transform:rotate(0);}}'
                + '.send-btn.zf-cast .a-flame{transform-origin:5px 12px;animation:aFlame .9s ease-out forwards;}'
                + '@keyframes aFlame{0%{opacity:0;transform:scale(.2);}18%{opacity:1;transform:scale(1.15);}55%{opacity:1;transform:scale(.9);}100%{opacity:0;transform:scale(.3) translateY(-2px);}}'
                + '.send-btn.zf-cast .a-flame{fill:#ffb020;stroke:none;}'
                + '.send-btn.zf-cast .a-smoke{animation:aSmoke 1.1s ease-out forwards;fill:#b9c4d6;opacity:0;}'
                + '@keyframes aSmoke{0%{opacity:0;transform:translate(0,0) scale(.5);}25%{opacity:.9;}100%{opacity:0;transform:translate(-1px,-6px) scale(1.6);}}';
            document.head.appendChild(st);
        }
        // 点击发送时触发一次神灯施法动画（仅神灯主题生效）
        document.addEventListener('click', function (e) {
            var btn = e.target && e.target.closest ? e.target.closest('.send-btn') : null;
            if (!btn || btn.classList.contains('sending')) return;
            if (getTheme() !== 'aladdin') return;
            btn.classList.remove('zf-cast');
            // 强制重启动画
            void btn.offsetWidth;
            btn.classList.add('zf-cast');
            setTimeout(function () { btn.classList.remove('zf-cast'); }, 950);
        }, true);
        applyAll();
        renderPicker();
        mo.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    window.App = window.App || {};
    App.setSendIconTheme = setTheme;
    App.renderSendIconThemePicker = renderPicker;
    App.SEND_ICON_THEMES = THEMES;
})();
