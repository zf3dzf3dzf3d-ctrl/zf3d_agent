/* ============================================================
 * app-growth-panel.js —— 智能体养成面板（成长可视化）v2
 * v2 改版（2026-10）：
 * 1) 等级数字改为右上角登录入口的右上角小角标，点击弹出养成面板
 *    （原侧边栏等级小条已移除）
 * 2) 面板美化：顶部渐变头图 + 成就墙每项带进度条
 * 3) 等级无上限（服务端等级曲线本身无封顶）
 * API: GET /api/growth/full
 * ============================================================ */
(function () {
    'use strict';
    var NS = window.__KiteNS = window.__KiteNS || {};
    if (NS.growthPanel) return; // 防重复注入

    var TIERS = { '幼蜂': '🐝', '工蜂': '🐜', '雄蜂': '🐝', '蜂后': '👑', '蜂王': '👑✨' };
    var lastLevel = null;

    function api() {
        return fetch('/api/growth/full', { cache: 'no-store' }).then(function (r) { return r.json(); });
    }

    // ===== 等级角标已迁移到「更多」菜单的「智能体等级」入口（不再挂在头像右上角） =====
    function ensureBadge() {
        // 清理历史遗留的头像角标，保持右上角只剩头像
        var old = document.getElementById('growthTopLv');
        if (old) old.remove();
    }

    function render(s) {
        if (!s || !s.ok) return;
        ensureBadge();
        var el = document.getElementById('growthTopLv');
        if (el) {
            el.textContent = s.level;
            el.dataset.tier = s.tier || '';
            // 每 10 级换一个色阶，越升越亮
            el.dataset.stage = String(Math.min(4, Math.floor((s.level - 1) / 10)));
        }
        // 升级动效
        if (lastLevel !== null && s.level > lastLevel) playLevelUp(s);
        lastLevel = s.level;
    }

    // ===== 升级全屏动效 =====
    function playLevelUp(s) {
        var ov = document.createElement('div');
        ov.className = 'growth-levelup';
        ov.innerHTML =
            '<div class="growth-levelup-card">' +
            '<div class="growth-levelup-glow"></div>' +
            '<div class="growth-levelup-icon">👑</div>' +
            '<div class="growth-levelup-title">等级提升！</div>' +
            '<div class="growth-levelup-lv">Lv.' + s.level + ' · ' + (s.tier || '') + '</div>' +
            '</div>';
        document.body.appendChild(ov);
        setTimeout(function () { ov.classList.add('show'); }, 10);
        setTimeout(function () {
            ov.classList.remove('show');
            setTimeout(function () { ov.remove(); }, 600);
        }, 2600);
    }

    // ===== 详情面板（挂右上角） =====
    function openPanel() {
        var old = document.getElementById('growthPanel');
        if (old) { old.remove(); return; }
        var p = document.createElement('div');
        p.id = 'growthPanel';
        p.className = 'growth-panel';
        p.innerHTML = '<div class="growth-panel-head">🐝 智能体养成<span class="growth-close" title="关闭">×</span></div>' +
                      '<div class="growth-panel-body"><div class="growth-loading">加载中…</div></div>';
        document.body.appendChild(p);
        p.querySelector('.growth-close').addEventListener('click', function () { p.remove(); });
        // 左侧拖拽手柄：从左边缘拖拽调宽（宽度记忆沿用 ResizeObserver）
        var lh = document.createElement('div');
        lh.className = 'growth-lhandle';
        lh.title = '拖拽调整面板宽度';
        p.appendChild(lh);
        lh.addEventListener('pointerdown', function (e) {
            e.preventDefault();
            var startX = e.clientX, startW = p.offsetWidth;
            var maxW = Math.max(260, Math.floor(window.innerWidth * 0.6));
            lh.setPointerCapture(e.pointerId);
            p.classList.add('resizing');
            function onMove(ev) {
                var w = Math.min(maxW, Math.max(260, startW + (startX - ev.clientX)));
                p.style.width = w + 'px';
            }
            function onUp(ev) {
                lh.removeEventListener('pointermove', onMove);
                lh.removeEventListener('pointerup', onUp);
                lh.removeEventListener('pointercancel', onUp);
                p.classList.remove('resizing');
                try { localStorage.setItem('growthPanelW', p.offsetWidth); } catch (err) { }
            }
            lh.addEventListener('pointermove', onMove);
            lh.addEventListener('pointerup', onUp);
            lh.addEventListener('pointercancel', onUp);
        });
        // 宽度记忆：恢复上次拖拽宽度 + 拖拽时实时保存
        try {
            var savedW = parseInt(localStorage.getItem('growthPanelW'), 10);
            var maxW = Math.floor(window.innerWidth * 0.6);
            if (savedW >= 260 && savedW <= Math.max(260, maxW)) p.style.width = savedW + 'px';
        } catch (e) { }
        if (window.ResizeObserver) {
            new ResizeObserver(function () {
                try { localStorage.setItem('growthPanelW', p.offsetWidth); } catch (e) { }
            }).observe(p);
        }
        api().then(function (s) {
            var b = p.querySelector('.growth-panel-body');
            if (!s || !s.ok) { b.innerHTML = '<div class="growth-loading">暂无数据</div>'; return; }
            b.innerHTML =
                '<div class="growth-hero">' +
                  '<div class="growth-hero-icon">' + (TIERS[s.tier] || '🐝') + '</div>' +
                  '<div class="growth-hero-info"><b>' + (s.tier || '幼蜂') + ' Lv.' + s.level + '</b>' +
                  '<div class="growth-xp">经验 ' + s.exp + '（' + s.exp_in_level + '/' + s.exp_need + '）· 无上限</div></div>' +
                '</div>' +
                '<div class="growth-bar"><i style="width:' + (s.pct || 0) + '%"></i></div>' +
                '<div class="growth-stats">' +
                  '<div title="累计完成的任务数量，每完成一个任务获得经验"><span>' + (s.task_done || 0) + '</span><label>完成任务</label></div>' +
                  '<div title="任务成功次数占总次数的百分比"><span>' + (s.success_rate || 0) + '%</span><label>成功率</label></div>' +
                  '<div title="累计记录的成长事件总数（含签到、审核、纠错等）"><span>' + (s.total_events || 0) + '</span><label>成长事件</label></div>' +
                '</div>' +
                '<div class="growth-sec-title" title="达成条件后点亮的徽章，鼠标悬停可查看获取方式">🏅 成就墙</div>' +
                '<div class="growth-badges" id="growthBadges"></div>' +
                '<div class="growth-share-row">' +
                  '<button class="growth-checkin-btn" id="growthCheckinBtn">' + (s.checkin && s.checkin.checked ? '✅ 今日已签到（连续 ' + s.checkin.streak + ' 天）' : '📅 每日签到 +30 经验') + '</button>' +
                  '<button class="growth-share-btn" id="growthShareBtn">📸 生成晒图卡片</button>' +
                '</div>' +
                '<div class="growth-sec-title" title="达到等级/条件后自动掌握的技能徽章">🌳 技能树</div>' +
                '<div class="growth-skills" id="growthSkills"></div>' +
                '<div class="growth-sec-title" title="每周重置的挑战目标，完成后点亮">🎯 周挑战</div>' +
                '<div class="growth-weekly" id="growthWeekly"></div>' +
                '<div class="growth-tip">完成任务、蜂群审核通过、用户纠错采纳、每日签到均可获得经验。<br>等级没有上限，成就与技能只是仪式感，不影响任何功能。</div>';
            p.__growthSummary = s;
            renderBadges(p, s.badges || []);
            renderSkills(p, s.skills || []);
            renderWeekly(p, s.weekly || {});
            bindCheckin(p, s.checkin || {});
        }).catch(function () {
            var b = p.querySelector('.growth-panel-body');
            if (b) b.innerHTML = '<div class="growth-loading">加载失败</div>';
        });
    }

    // ===== 技能树渲染 =====
    function escAttr(t) {
        return String(t === undefined || t === null ? '' : t)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    }
    function renderSkills(p, skills) {
        var box = p.querySelector('#growthSkills');
        if (!box) return;
        box.innerHTML = skills.map(function (k) {
            var cls = k.got ? ' got' : (k.meets ? ' ready' : '');
            return '<div class="growth-skill-item' + cls + '" title="' + escAttr(k.desc) + '">' +
                '<span class="gs-icon">' + (k.got ? k.icon : '🔒') + '</span>' +
                '<span class="gs-name">' + k.name + '</span>' +
                '<span class="gs-desc">' + (k.got ? '已掌握' : escAttr(k.desc)) + '</span></div>';
        }).join('');
    }

    // ===== 周挑战渲染 =====
    function renderWeekly(p, w) {
        var box = p.querySelector('#growthWeekly');
        if (!box) return;
        if (!w || !w.goals) { box.innerHTML = '<div class="growth-loading">暂无数据</div>'; return; }
        box.innerHTML = w.goals.map(function (g) {
            var pct = Math.min(100, Math.round(g.cur / g.goal * 100));
            return '<div class="growth-week-item' + (g.got ? ' got' : '') + '" title="' + escAttr((g.desc || '') + (g.got ? '（已完成）' : '（进行中）')) + '">' +
                '<span class="gw-icon">' + g.icon + '</span>' +
                '<div class="gw-main"><div class="gw-name">' + g.name + (g.got ? ' ✅' : '') + '</div>' +
                '<div class="gw-bar"><i style="width:' + pct + '%"></i></div></div>' +
                '<span class="gw-num">' + Math.min(g.cur, g.goal) + '/' + g.goal + '</span></div>';
        }).join('');
    }

    // ===== 签到 =====
    function bindCheckin(p, ci) {
        var btn = p.querySelector('#growthCheckinBtn');
        if (!btn || btn.dataset.bound) return;
        if (ci.checked) { btn.disabled = true; return; }
        btn.dataset.bound = '1';
        btn.addEventListener('click', function () {
            btn.disabled = true; btn.textContent = '⏳ 签到中…';
            fetch('/api/growth/checkin', { method: 'POST' }).then(function (r) { return r.json(); }).then(function (r) {
                if (r.ok) {
                    btn.textContent = '✅ 已签到 +' + r.exp_gained + ' 经验（连续 ' + r.streak + ' 天）';
                    if (r.leveled_up) playLevelUp({ level: r.level });
                    if (r.new_skills && r.new_skills.length) playSkillToast(r.new_skills);
                    setTimeout(function () { api().then(render).catch(function () { }); }, 1200);
                } else if (r.reason === 'already') {
                    btn.textContent = '✅ 今日已签到';
                } else {
                    btn.textContent = '签到失败'; btn.disabled = false;
                }
            }).catch(function () { btn.textContent = '签到失败'; btn.disabled = false; });
        });
    }

    // ===== 新技能获得提示 =====
    function playSkillToast(skills) {
        var ov = document.createElement('div');
        ov.className = 'growth-levelup';
        ov.innerHTML = '<div class="growth-levelup-card"><div class="growth-levelup-icon">🌳</div>' +
            '<div class="growth-levelup-title">掌握新技能！</div>' +
            '<div class="growth-levelup-lv">' + skills.map(function (k) { return k.icon + ' ' + k.name; }).join('　') + '</div></div>';
        document.body.appendChild(ov);
        setTimeout(function () { ov.classList.add('show'); }, 10);
        setTimeout(function () { ov.classList.remove('show'); setTimeout(function () { ov.remove(); }, 600); }, 2600);
    }

    // ===== 成就墙渲染（每项带进度条） =====
    function renderBadges(p, badges) {
        var box = p.querySelector('#growthBadges');
        if (!box) return;
        box.innerHTML = badges.map(function (b) {
            var cur = (b.cur !== undefined) ? b.cur : (b.got ? 1 : 0);
            var goal = (b.goal !== undefined) ? b.goal : 1;
            var pct = Math.min(100, Math.round(cur / Math.max(1, goal) * 100));
            if (b.got) pct = 100;
            return '<div class="growth-badge-item' + (b.got ? ' got' : '') + '" title="' + escAttr(b.desc) + '">' +
                '<span class="gb-icon">' + (b.got ? b.icon : '🔒') + '</span>' +
                '<span class="gb-name">' + b.name + '</span>' +
                '<div class="gb-bar"><i style="width:' + pct + '%"></i></div>' +
                '<span class="gb-num">' + Math.min(cur, goal) + '/' + goal + '</span></div>';
        }).join('');
        var btn = p.querySelector('#growthShareBtn');
        if (btn && !btn.dataset.bound) {
            btn.dataset.bound = '1';
            btn.addEventListener('click', function () { makeShareCard(p, badges); });
        }
    }

    // ===== canvas 晒图卡片 =====
    function makeShareCard(p, badges) {
        var s = p.__growthSummary; if (!s) return;
        var cv = document.createElement('canvas');
        cv.width = 640; cv.height = 400;
        var c = cv.getContext('2d');
        var g = c.createLinearGradient(0, 0, 640, 400);
        g.addColorStop(0, '#1a2332'); g.addColorStop(1, '#2d3a4f');
        c.fillStyle = g; c.fillRect(0, 0, 640, 400);
        c.fillStyle = '#f5c542'; c.font = 'bold 60px sans-serif'; c.textAlign = 'center';
        c.fillText('🐝', 320, 90);
        c.fillStyle = '#fff'; c.font = 'bold 30px sans-serif';
        c.fillText((s.tier || '') + '  Lv.' + s.level, 320, 150);
        // 经验进度条
        c.fillStyle = 'rgba(255,255,255,.15)'; c.fillRect(120, 175, 400, 14);
        c.fillStyle = '#f5c542'; c.fillRect(120, 175, 400 * (s.pct || 0) / 100, 14);
        c.font = '16px sans-serif'; c.fillStyle = '#aab';
        c.fillText('经验 ' + s.exp_in_level + ' / ' + s.exp_need, 320, 212);
        // 三项统计
        var stats = [[s.task_done + '', '完成任务'], [(s.success_rate || 0) + '%', '成功率'], [s.exp + '', '总经验']];
        stats.forEach(function (it, i) {
            var x = 170 + i * 150;
            c.fillStyle = '#fff'; c.font = 'bold 26px sans-serif'; c.fillText(it[0], x, 270);
            c.font = '13px sans-serif'; c.fillStyle = '#99a'; c.fillText(it[1], x, 294);
        });
        // 成就一行
        var gotIcons = badges.filter(function (b) { return b.got; }).map(function (b) { return b.icon; }).join(' ');
        c.font = '22px sans-serif'; c.fillStyle = '#f5c542';
        c.fillText(gotIcons || '🐣', 320, 340);
        c.font = '13px sans-serif'; c.fillStyle = '#889';
        c.fillText('朱峰社区智能体无限 · 我的智能体养成足迹', 320, 378);
        var url = cv.toDataURL('image/png');
        // 预览弹窗：先让用户看到卡片，再决定是否保存
        var prevOv = document.querySelector('.growth-share-preview');
        if (prevOv) prevOv.remove();
        var ov = document.createElement('div');
        ov.className = 'growth-share-preview';
        ov.innerHTML = '<div class="gsp-mask"></div>' +
            '<div class="gsp-box">' +
              '<div class="gsp-head">📸 晒图卡片预览<span class="gsp-close" title="关闭">×</span></div>' +
              '<img class="gsp-img" src="' + url + '" alt="晒图卡片">' +
              '<div class="gsp-actions">' +
                '<button class="gsp-save">⬇️ 保存图片</button>' +
                '<button class="gsp-copy">📋 复制到剪贴板</button>' +
              '</div>' +
            '</div>';
        document.body.appendChild(ov);
        requestAnimationFrame(function () { ov.classList.add('show'); });
        function closeOv() { ov.classList.remove('show'); setTimeout(function () { ov.remove(); }, 250); }
        ov.querySelector('.gsp-mask').addEventListener('click', closeOv);
        ov.querySelector('.gsp-close').addEventListener('click', closeOv);
        ov.querySelector('.gsp-save').addEventListener('click', function () {
            var a = document.createElement('a');
            a.href = url; a.download = 'growth-card-lv' + s.level + '.png'; a.click();
        });
        ov.querySelector('.gsp-copy').addEventListener('click', function () {
            var btn = this;
            cv.toBlob(function (blob) {
                if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
                    navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(function () {
                        btn.textContent = '✅ 已复制'; setTimeout(function () { btn.textContent = '📋 复制到剪贴板'; }, 1500);
                    }).catch(function () { btn.textContent = '❌ 复制失败'; setTimeout(function () { btn.textContent = '📋 复制到剪贴板'; }, 1500); });
                } else {
                    btn.textContent = '❌ 浏览器不支持'; setTimeout(function () { btn.textContent = '📋 复制到剪贴板'; }, 1500);
                }
            });
        });
    }

    // ===== 启动：DOM ready 后注入 + 60s 轮询 =====
    function boot() {
        ensureBadge();
        api().then(render).catch(function () { });
        // 登录入口可能后渲染，兜底再试几次
        var tries = 0;
        var t = setInterval(function () {
            tries++;
            if (document.getElementById('growthTopLv') || tries > 10) clearInterval(t);
            else ensureBadge();
        }, 1000);
        setInterval(function () { api().then(render).catch(function () { }); }, 60000);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        setTimeout(boot, 800);
    }
    NS.growthPanel = { open: openPanel, refresh: function () { api().then(render); } };
})();
