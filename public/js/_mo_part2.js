
    // ===== 节点收集（打开时快照一次） =====
    function kiteColor(kind) {
        var map = {
            chat: '#3498db', image: '#e67e22', note: '#f1c40f',
            media: '#9b59b6', quick: '#2ecc71', unknown: '#95a5a6'
        };
        return map[kind] || map.unknown;
    }
    function nodeKind(el) {
        if (el.classList.contains('kite-node')) return 'chat';
        if (el.classList.contains('kite-image-panel')) return 'image';
        if (el.classList.contains('quick-note')) return 'note';
        if (el.classList.contains('media-canvas-node')) return 'media';
        return 'chat';
    }
    function nodeTitle(el) {
        var t = el.querySelector('.chat-title, .chatbox-header .title, .box-title, .title-text, .quick-note-title');
        if (t && t.textContent) return t.textContent.trim().substring(0, 24) || '节点';
        return '节点';
    }
    function findChat(el) {
        var cb = (window.App && App.chatBoxes) || [];
        for (var i = 0; i < cb.length; i++) if (cb[i] && cb[i].el === el) return cb[i];
        return null;
    }
    function collectNodes() {
        cards = []; byEl.clear(); selected.clear();
        var root = $('canvasContent') || $('canvasArea') || document;
        var sel = '.chatbox, .chat-box, .kite-node, .kite-image-panel, .quick-note, .media-canvas-node';
        var els = root.querySelectorAll(sel);
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            if (!el.parentNode || el.style.display === 'none') continue;
            cards.push({
                el: el, chat: findChat(el),
                x: el.offsetLeft, y: el.offsetTop,
                w: el.offsetWidth || 260, h: el.offsetHeight || 180,
                title: nodeTitle(el), color: kiteColor(nodeKind(el))
            });
            byEl.set(el, cards[cards.length - 1]);
        }
    }

    // ===== 渲染卡片 DOM（全量重建一次；仅打开/排列/关闭节点后调用） =====
    function buildCards() {
        world.innerHTML = '';
        for (var i = 0; i < cards.length; i++) {
            var c = cards[i];
            var d = document.createElement('div');
            d.className = 'mo-card';
            d.style.width = c.w + 'px';
            d.style.height = c.h + 'px';
            d.innerHTML =
                '<div class="mo-card-bar" style="background:' + c.color + '"></div>' +
                '<div class="mo-card-title">' + escHtml(c.title) + '</div>' +
                '<div class="mo-card-body" style="border-top-color:' + c.color + '"></div>';
            c.dom = d;
            applyCardPos(c);
            world.appendChild(d);
        }
        applyView();
        refreshSelect();
    }
    function escHtml(s) {
        return String(s).replace(/[&<>"']/g, function (m) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
        });
    }
    function applyCardPos(c) {
        c.dom.style.left = c.x + 'px';
        c.dom.style.top = c.y + 'px';
    }

    // ===== 视图（缩放/平移）——只改 world 的 transform =====
    function applyView() {
        world.style.transform = 'translate(' + view.x + 'px,' + view.y + 'px) scale(' + view.s + ')';
    }
    function fitView() {
        if (!cards.length) { view = { x: 0, y: 0, s: 1 }; applyView(); return; }
        var vp = overlay.querySelector('.mo-viewport');
        var vw = vp.clientWidth || 800, vh = vp.clientHeight || 500;
        var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (var i = 0; i < cards.length; i++) {
            var c = cards[i];
            if (c.x < minX) minX = c.x; if (c.y < minY) minY = c.y;
            if (c.x + c.w > maxX) maxX = c.x + c.w;
            if (c.y + c.h > maxY) maxY = c.y + c.h;
        }
        var pad = 40;
        var s = Math.min((vw - pad * 2) / (maxX - minX || 1), (vh - pad * 2) / (maxY - minY || 1), 1);
        s = Math.max(s, 0.15);
        view.s = s;
        view.x = (vw - (maxX + minX) * s) / 2;
        view.y = (vh - (maxY + minY) * s) / 2;
        applyView();
    }
