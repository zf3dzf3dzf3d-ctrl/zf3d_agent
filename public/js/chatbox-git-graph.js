/**
 * chatbox-git-graph.js — 📊 Git 分支图谱弹窗（5.2.5 新增）
 * 左侧：Canvas 绘制的提交拓扑图（ lanes 按 first-parent 链分轨）
 * 右侧：分支名称 + 最近提交时间列表
 * 数据来源：GET /api/git/graph?path=...&limit=...
 * 全局暴露 window.ZfGitGraph = { open(repoPath) }
 */
(function() {
    'use strict';

    var COLORS = ['#4fc3f7', '#ffd54f', '#81c784', '#f48fb1', '#b39ddb', '#4db6ac', '#ffb74d', '#e57373'];

    function _api(url) {
        return fetch(url).then(function(r) { return r.json(); });
    }

    function _esc(s) {
        return String(s || '').replace(/[&<>"]/g, function(c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    function _fmtTime(ms) {
        if (!ms) return '';
        var d = new Date(ms);
        function p(n) { return (n < 10 ? '0' : '') + n; }
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    function _close() {
        var old = document.querySelector('.gg-overlay');
        if (old) old.remove();
    }

    /**
     * 拓扑布局：按 git log 顺序（后端已 date-order），每个 commit 落到一条 lane。
     * 规则：优先继承 parent 的 lane（first-parent 链保持直线），否则开新 lane。
     */
    function _layout(commits) {
        var laneOf = {};       // hash -> lane
        var parentsOf = {};    // hash -> parents（用于识别 first-parent 链）
        var nextLane = 0;
        var nodes = [];
        var maxLane = 0;
        commits.forEach(function(c) { parentsOf[c.hash] = c.parents || []; });
        // 后端 children 是顶层字典而非每提交字段，这里直接从 parents 反推，最可靠
        var childrenOf = {};
        commits.forEach(function(c) {
            (c.parents || []).forEach(function(p) {
                (childrenOf[p] = childrenOf[p] || []).push(c.hash);
            });
        });
        // 提交列表从新到旧。父提交直接继承 first-parent 子提交的 lane，
        // 保证主链（first-parent 链）始终是一条竖直直线；
        // 只有被合并进来的旁支提交才开新 lane，合并处用直角折线过渡
        commits.forEach(function(c) {
            var lane;
            var kids = (childrenOf[c.hash] || []).slice().reverse(); // 倒序=最旧子提交优先，分叉点留在主链 lane
            for (var i = 0; i < kids.length; i++) {
                var ch = kids[i];
                var cl = laneOf[ch];
                if (cl === undefined) continue;
                var ps = parentsOf[ch] || [];
                if (ps[0] === c.hash) { lane = cl; break; }   // 我是它的第一父提交 → 直线继承
            }
            // 非第一父链（旁支/被 merge 的分支）→ 开新 lane
            if (lane === undefined) lane = nextLane++;
            if (lane > maxLane) maxLane = lane;
            laneOf[c.hash] = lane;
            nodes.push({ c: c, lane: lane });
        });
        return { nodes: nodes, laneCount: maxLane + 1 };
    }

    function _svg(nodes, laneCount) {
        var rowH = 34, dotR = 4.5, laneW = 14, leftPad = 10;
        var width = 44; /* 固定 44px 图形列，与 .gg-gutter 对齐 */
        var height = nodes.length * rowH;
        function x(lane) { return leftPad + lane * laneW; }
        function y(i) { return i * rowH + rowH / 2; }
        var indexOf = {};
        nodes.forEach(function(n, i) { indexOf[n.c.hash] = i; });
        var perRow = nodes.map(function() { return ''; });   // 每行的 svg 片段
        function add(i, frag) { perRow[i] += frag; }
        /* 连线：全局坐标绘制后按行切片（跨行的竖线两端都画，保证切片后连续） */
        nodes.forEach(function(n, i) {
            var col = COLORS[n.lane % COLORS.length];
            (n.c.parents || []).forEach(function(p) {
                var j = indexOf[p];
                if (j === undefined) return;
                if (n.lane === nodes[j].lane) {
                    var y1 = Math.min(y(i), y(j)), y2 = Math.max(y(i), y(j));
                    var xL = x(n.lane);
                    /* 竖线：按行拆成段，只落到经过的行 */
                    for (var r = Math.floor(y1 / rowH); r <= Math.min(Math.floor((y2 - 0.01) / rowH), nodes.length - 1); r++) {
                        var segTop = Math.max(y1, r * rowH) - r * rowH;
                        var segBot = Math.min(y2, (r + 1) * rowH) - r * rowH;
                        add(r, '<line x1="' + xL + '" y1="' + segTop + '" x2="' + xL + '" y2="' + segBot + '" stroke="' + col + '" stroke-width="2"/>');
                    }
                } else {
                    var mid = (y(i) + y(j)) / 2;
                    var xA = x(n.lane), xB = x(nodes[j].lane);
                    var rA = Math.floor(y(i) / rowH), rM = Math.floor(mid / rowH);
                    /* 出发行：竖直段到行底 */
                    add(i, '<line x1="' + xA + '" y1="' + (y(i) - i * rowH) + '" x2="' + xA + '" y2="' + rowH + '" stroke="' + col + '" stroke-width="2"/>');
                    /* 中间整行：水平线 */
                    for (var r = rA + 1; r < rM; r++) {
                        add(r, '<line x1="' + Math.min(xA, xB) + '" y1="0" x2="' + Math.max(xA, xB) + '" y2="0" stroke="' + col + '" stroke-width="2"/>');
                    }
                    if (rM !== rA) {
                        /* 目标行上半段：水平线 + 到父节点的竖直段 */
                        add(rM, '<line x1="' + Math.min(xA, xB) + '" y1="0" x2="' + Math.max(xA, xB) + '" y2="0" stroke="' + col + '" stroke-width="2"/>');
                        add(rM, '<line x1="' + xB + '" y1="0" x2="' + xB + '" y2="' + (y(j) - rM * rowH) + '" stroke="' + col + '" stroke-width="2"/>');
                    } else {
                        add(rA, '<line x1="' + Math.min(xA, xB) + '" y1="' + (mid - rA * rowH) + '" x2="' + Math.max(xA, xB) + '" y2="' + (mid - rA * rowH) + '" stroke="' + col + '" stroke-width="2"/>');
                        add(rA, '<line x1="' + xB + '" y1="' + (mid - rA * rowH) + '" x2="' + xB + '" y2="' + (y(j) - rA * rowH) + '" stroke="' + col + '" stroke-width="2"/>');
                    }
                }
            });
        });
        /* 节点圆点 */
        nodes.forEach(function(n, i) {
            var col = COLORS[n.lane % COLORS.length];
            add(i, '<circle cx="' + x(n.lane) + '" cy="' + (y(i) - i * rowH) + '" r="' + dotR + '" fill="' + col + '" stroke="#1b2130" stroke-width="1.5"/>');
        });
        return { perRow: perRow, rowH: rowH };
    }

    function open(repoPath) {
        _close();
        var ov = document.createElement('div');
        ov.className = 'gg-overlay';
        ov.innerHTML =
            '<div class="gg-dialog">' +
                '<div class="gg-head">' +
                    '<span class="gg-title">📊 分支图谱</span>' +
                    '<span class="gg-repo">' + _esc(repoPath) + '</span>' +
                    '<button class="gg-close" type="button" title="关闭">✕</button>' +
                '</div>' +
                '<div class="gg-body">' +
                    '<div class="gg-loading"><span class="gg-spin"></span>正在读取提交历史…</div>' +
                '</div>' +
            '</div>';
        document.body.appendChild(ov);

        ov.querySelector('.gg-close').onclick = _close;
        ov.addEventListener('click', function(e) { if (e.target === ov) _close(); });
        var onKey = function(e) { if (e.key === 'Escape') { _close(); document.removeEventListener('keydown', onKey); } };
        document.addEventListener('keydown', onKey);

        _api('/api/git/graph?path=' + encodeURIComponent(repoPath) + '&limit=300')
            .then(function(res) {
                var body = ov.querySelector('.gg-body');
                if (!res.ok) {
                    body.innerHTML = '<div class="gg-error">❌ ' + _esc(res.error || '读取失败') + '</div>';
                    return;
                }
                var branches = res.branches || [];
                var commits = res.commits || [];
                var layout = _layout(commits);
                var svgRes = _svg(layout.nodes, layout.laneCount);
                var headRe = /^(HEAD|origin)/;
                var rows = layout.nodes.map(function(n, i) {
                    var c = n.c;
                    var refs = (c.refs || []).filter(function(r) { return headRe.test(r); });
                    return '<div class="gg-row" style="height:' + svgRes.rowH + 'px">' +
                        '<span class="gg-gutter"><svg width="44" height="' + svgRes.rowH + '" viewBox="0 0 44 ' + svgRes.rowH + '">' +
                            svgRes.perRow[i] +
                        '</svg></span>' +
                        '<span class="gg-t-col">' + _esc(_fmtTime(c.time)) + '</span>' +
                        '<span class="gg-ref-col">' + (refs.length ? _esc(refs.join(' ')) : '') + '</span>' +
                        '<span class="gg-msg-col" title="' + _esc(c.subject) + '">' + _esc(c.subject) + '</span>' +
                        '<span class="gg-auth-col">' + _esc(c.author || '') + '</span>' +
                    '</div>';
                }).join('');
                body.innerHTML =
                    '<div class="gg-main">' +
                        '<div class="gg-table">' +
                            '<div class="gg-thead gg-row">' +
                                '<span class="gg-gutter"></span>' +
                                '<span class="gg-t-col">时间</span>' +
                                '<span class="gg-ref-col">分支/标签</span>' +
                                '<span class="gg-msg-col">提交信息</span>' +
                                '<span class="gg-auth-col">作者</span>' +
                            '</div>' +
                            '<div class="gg-tbody-wrap">' +
                                '<div class="gg-tbody" style="position:relative">' + rows + '</div>' +
                            '</div>' +
                        '</div>' +
                        '<div class="gg-side">' +
                            '<div class="gg-side-title">分支（' + branches.length + '）</div>' +
                            (branches.length ?
                                branches.map(function(b) {
                                    return '<div class="gg-branch" data-hash="' + _esc(b.hash) + '">' +
                                        '<span class="gg-dot" style="background:' + COLORS[0] + '"></span>' +
                                        '<span class="gg-bname" title="' + _esc(b.name) + '">' + _esc(b.name) + '</span>' +
                                        '<span class="gg-bwhen">' + _esc(b.when || '') + '</span>' +
                                    '</div>';
                                }).join('') :
                                '<div class="gg-empty">无分支</div>') +
                        '</div>' +
                    '</div>';
            })
            .catch(function(err) {
                ov.querySelector('.gg-body').innerHTML = '<div class="gg-error">❌ ' + _esc(err) + '</div>';
            });
    }

    // ── 样式（一次性注入）──
    (function injectCss() {
        if (document.getElementById('zf-git-graph-css')) return;
        var st = document.createElement('style');
        st.id = 'zf-git-graph-css';
        st.textContent =
            '.gg-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:99990;display:flex;align-items:center;justify-content:center;}' +
            '.gg-dialog{background:#161b26;border:1px solid #2c3446;border-radius:12px;width:min(1100px,94vw);height:min(760px,90vh);display:flex;flex-direction:column;box-shadow:0 12px 40px rgba(0,0,0,.5);overflow:hidden;}' +
            '.gg-head{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #2c3446;background:#1b2130;flex:none;}' +
            '.gg-title{font-weight:600;color:#e8edf5;font-size:15px;}' +
            '.gg-repo{color:#8a94a8;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;}' +
            '.gg-close{background:none;border:none;color:#8a94a8;font-size:16px;cursor:pointer;padding:4px 6px;}' +
            '.gg-close:hover{color:#fff;}' +
            '.gg-body{flex:1;overflow:auto;padding:12px 16px;}' +
            '.gg-loading{color:#8a94a8;padding:40px;text-align:center;}' +
            '.gg-spin{display:inline-block;width:14px;height:14px;border:2px solid #4fc3f7;border-top-color:transparent;border-radius:50%;vertical-align:-2px;margin-right:6px;animation:ggs 1s linear infinite;}' +
            '@keyframes ggs{to{transform:rotate(360deg)}}' +
            '.gg-error{color:#f66;padding:40px;text-align:center;}' +
            '.gg-main{display:flex;gap:16px;align-items:stretch;}' +
            '.gg-table{flex:1;min-width:0;display:flex;flex-direction:column;}' +
            '.gg-tbody-wrap{flex:1;overflow:auto;}' +
            '.gg-row{display:flex;align-items:center;gap:10px;padding:0 8px 0 0;font-size:12px;border-bottom:1px solid rgba(44,52,70,.4);}' +
            '.gg-gutter{flex:none;width:44px;align-self:stretch;display:flex;align-items:center;overflow:visible;}' +
            '.gg-gutter svg{display:block;}' +
            '.gg-thead{color:#8a94a8;font-size:11px;height:32px;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #2c3446;flex:none;}' +
            '.gg-t-col{flex:none;width:118px;color:#8a94a8;font-family:Consolas,monospace;}' +
            '.gg-ref-col{flex:none;width:130px;color:#4fc3f7;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
            '.gg-msg-col{flex:1;min-width:0;color:#d7dee9;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
            '.gg-auth-col{flex:none;width:90px;color:#8a94a8;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;}' +
            '.gg-side{flex:none;width:240px;border-left:1px solid #2c3446;padding-left:16px;align-self:flex-start;position:sticky;top:0;}' +
            '.gg-side-title{color:#8a94a8;font-size:12px;margin-bottom:8px;text-transform:uppercase;letter-spacing:.5px;}' +
            '.gg-branch{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:8px;font-size:13px;}' +
            '.gg-branch:hover{background:#1f2736;}' +
            '.gg-dot{width:10px;height:10px;border-radius:50%;flex:none;}' +
            '.gg-bname{color:#e8edf5;font-family:Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;}' +
            '.gg-bwhen{color:#8a94a8;font-size:11px;flex:none;}' +
            '.gg-empty{color:#5a6478;font-size:13px;padding:12px;}';
        document.head.appendChild(st);
    })();

    window.ZfGitGraph = { open: open };
})();
