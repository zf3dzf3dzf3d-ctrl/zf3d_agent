// ========== chatbox-spawn-habit.js - 子对话框出生位置习惯记忆 ==========
// 记住用户把各类子窗（策划师/审核员/施工队/总结师等）拖到哪里，
// 下次新建同角色窗时优先放到用户习惯的位置。
// 习惯粒度：角色 × 同父同角色序号（第1个/第2个/第3个…各自记忆）
// 只影响"创建那一刻"，创建后仍由 chatbox-relative-restore 守恒，互不冲突。
(function () {
    'use strict';
    var LS_KEY = 'zf_spawn_habit_v1';
    var LS_ENABLE_KEY = 'zf_spawn_habit_enabled';
    var MAX_SLOTS = 8;           // 每角色最多记 8 个槽位，环形覆盖
    var HABIT_MAX_AGE = 30 * 24 * 3600 * 1000; // 30 天未使用自动清理
    var ROLE_WHITELIST = ['策划师', '审核员', '施工队', '协作队', '总结师', '质检员', '技术可行性', '收口'];

    function enabled() {
        try { return localStorage.getItem(LS_ENABLE_KEY) !== '0'; } catch (e) { return true; }
    }

    function load() {
        try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}') || {}; } catch (e) { return {}; }
    }
    function save(data) {
        try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch (e) {}
    }

    /* ---------- 角色识别：从窗口 DOM/角色信息推断角色键 ---------- */
    function roleKeyOf(box) {
        if (!box) return null;
        var name = '';
        try {
            // 1) 显式角色标记（openRoleChat 创建的）
            var rid = box.getAttribute && box.getAttribute('data-role-id');
            var rname = box.getAttribute && box.getAttribute('data-role-name');
            if (rname) name = rname;
            if (!name && rid) {
                try {
                    var stored = JSON.parse(localStorage.getItem('zf_role_chat_' + (box.dataset && box.dataset.boxId || box.id)) || 'null');
                    if (stored && stored.name) name = stored.name;
                } catch (e) {}
            }
            // 2) 标题栏匹配
            if (!name) {
                var t = box.querySelector && box.querySelector('.chat-title, .chatbox-title, [class*="title"]');
                if (t && t.textContent) name = t.textContent.trim();
            }
        } catch (e) {}
        if (!name) return null;
        for (var i = 0; i < ROLE_WHITELIST.length; i++) {
            if (name.indexOf(ROLE_WHITELIST[i]) !== -1) return ROLE_WHITELIST[i];
        }
        return null;
    }

    /* ---------- 序号：同角色当前已有几个（创建前统计） ---------- */
    function seqOf(roleKey) {
        var n = 0;
        try {
            document.querySelectorAll('.chatbox').forEach(function (b) {
                if (roleKeyOf(b) === roleKey) n++;
            });
        } catch (e) {}
        return Math.min(n + 1, MAX_SLOTS);
    }

    /* ---------- 记录：拖拽结束时写入习惯 ---------- */
    function recordHabit(box) {
        if (!enabled() || !box || !box.parentNode) return;
        var roleKey = roleKeyOf(box);
        if (!roleKey) return;
        // 被守恒模块管理的窗不用习惯定位（重启恢复走原逻辑），但记录习惯仍有效
        var parent = findParentBox(box);
        var data = load();
        var entry = data[roleKey] || {};
        var seq = box._zfHabitSeq || seqOf(roleKey);
        // 计算相对父窗偏移（无父窗则相对画布）
        var dx, dy;
        try {
            var bl = box.offsetLeft, bt = box.offsetTop;
            if (parent && parent.offsetLeft !== undefined) {
                dx = bl - parent.offsetLeft; dy = bt - parent.offsetTop;
            } else { dx = bl; dy = bt; }
        } catch (e) { return; }
        entry[seq] = { dx: Math.round(dx), dy: Math.round(dy), ts: Date.now() };
        // 环形覆盖 + 过期清理
        var keys = Object.keys(entry).map(Number).sort(function (a, b) { return a - b; });
        if (keys.length > MAX_SLOTS) delete entry[keys[0]];
        for (var k in entry) { if (Date.now() - entry[k].ts > HABIT_MAX_AGE) delete entry[k]; }
        data[roleKey] = entry;
        save(data);
    }

    /* ---------- 找父窗：先看相对偏移标记，再看视觉上的宿主 ---------- */
    function findParentBox(box) {
        try {
            var pid = box.getAttribute('data-parent-box') || box._zfParentId;
            if (pid) {
                var p = document.querySelector('.chatbox[data-box-id="' + pid + '"], .chatbox#' + pid);
                if (p) return p;
            }
            // 找与该窗最近的其他 chatbox（同画布、面积最大且包含该窗左上角者简化为取第一个非自身）
            var best = null, bestDist = Infinity;
            document.querySelectorAll('.chatbox').forEach(function (b) {
                if (b === box) return;
                var d = Math.abs(b.offsetLeft - box.offsetLeft) + Math.abs(b.offsetTop - box.offsetTop);
                if (d < bestDist) { bestDist = d; best = b; }
            });
            return best;
        } catch (e) { return null; }
    }

    /* ---------- 查习惯：返回期望绝对坐标，未命中返回 null ---------- */
    function queryHabit(roleKey, parentEl) {
        if (!enabled() || !roleKey) return null;
        var data = load();
        var entry = data[roleKey];
        if (!entry) return null;
        var seq = seqOf(roleKey);
        var rec = entry[seq];
        if (!rec) {
            // 该序号无记录：级联用上一档 +60/+40
            var prevKeys = Object.keys(entry).map(Number).sort(function (a, b) { return a - b; }).filter(function (k) { return k < seq; });
            if (!prevKeys.length) return null;
            var prev = entry[prevKeys[prevKeys.length - 1]];
            rec = { dx: prev.dx + 60, dy: prev.dy + 40 };
        }
        var parent = parentEl || null;
        // 未显式传父窗时才从 active 窗推断（避免新创建的同角色窗成为 active 导致偏移叠加）
        if (!parent) {
            try {
                var active = document.querySelector('.chatbox.active');
                if (active) parent = active;
            } catch (e) {}
        }
        var x, y;
        if (parent) { x = parent.offsetLeft + rec.dx; y = parent.offsetTop + rec.dy; }
        else { x = rec.dx; y = rec.dy; }
        // 【修复】画布逻辑坐标可无限平移（源窗可能在9万+处），不允许按视口大小钳制，
        // 否则习惯坐标会被压回视口内的小值，导致新窗远离源窗"飞走"。只防非法值。
        if (!isFinite(x)) x = 160;
        if (!isFinite(y)) y = 160;
        return { x: Math.round(x), y: Math.round(y), seq: seq };
    }

    /* ---------- hook createChatBox：未显式传坐标时用习惯定位 ---------- */
    function hookCreate() {
        var tries = 0;
        (function wrap() {
            var A = window.App;
            if (!A || typeof A.createChatBox !== 'function') {
                if (++tries < 60) setTimeout(wrap, 100);
                return;
            }
            if (A._spawnHabitWrapped) return;
            A._spawnHabitWrapped = true;
            var orig = A.createChatBox.bind(A);
            A.createChatBox = function (x, y, m, t) {
                // 仅当调用方未传坐标（或非法）时才用习惯定位
                if (enabled() && (typeof x !== 'number' || isNaN(x))) {
                    // 从最近活跃窗推断角色：默认不加白名单干预（保持零回归），
                    // 只有当活跃窗本身是白名单角色时，新窗才用其习惯位置
                    var _rk = null;
                    try {
                        var act = document.querySelector('.chatbox.active');
                        if (act) _rk = roleKeyOf(act);
                    } catch (e) {}
                    if (_rk) {
                        var hit = queryHabit(_rk);
                        if (hit) { x = hit.x; y = hit.y; }
                    }
                }
                var chat = orig(x, y, m, t);
                // 标记本窗序号，便于拖拽时写对应槽位
                try {
                    if (chat) {
                        var box = chat.el || chat;
                        var act2 = document.querySelector('.chatbox.active');
                        var rk = roleKeyOf(act2);
                        if (rk) box._zfHabitSeq = seqOf(rk);
                    }
                } catch (e) {}
                return chat;
            };
        })();
    }

    /* ---------- 监听拖拽结束：记录习惯 ---------- */
    function initDragListener() {
        document.addEventListener('mouseup', function (ev) {
            setTimeout(function () { // 等位置落定
                try {
                    var box = ev.target && ev.target.closest ? ev.target.closest('.chatbox') : null;
                    if (box && box.classList && box.classList.contains('chatbox')) recordHabit(box);
                } catch (e) {}
            }, 60);
        }, true);
    }

    /* ---------- 设置面板 API ---------- */
    window.SpawnHabit = {
        isEnabled: enabled,
        setEnabled: function (on) { try { localStorage.setItem(LS_ENABLE_KEY, on ? '1' : '0'); } catch (e) {} },
        queryHabit: queryHabit,
        clear: function () { try { localStorage.removeItem(LS_KEY); } catch (e) {} },
        stats: function () {
            var data = load(), out = {};
            for (var k in data) out[k] = Object.keys(data[k]).length;
            return out;
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { hookCreate(); initDragListener(); });
    } else { hookCreate(); initDragListener(); }
})();
