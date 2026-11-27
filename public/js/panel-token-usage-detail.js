// 模型明细（调用明细）：内联渲染在 Token 统计面板内，可翻页 + 时间范围下拉
// 由 panel-token-usage.js 在渲染完后调用 window.__tuRenderInlineDetail(inlineEl)
(function () {
    if (window.__tuDetailPatched) return;
    window.__tuDetailPatched = true;

    var CUR = { range: '30d', model: '', q: '', page: 1 };
    var pageSize = 30;

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function fmtT(ms) { if (!ms) return '-'; if (ms < 1000) return ms + 'ms'; return (ms / 1000).toFixed(1) + 's'; }
    function fmtN(n) { n = Number(n) || 0; return n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n); }

    // 时间范围选项（值传给后端 range 参数）
    var RANGES = [
        ['today', '今天'],
        ['7d', '近 7 天'],
        ['30d', '近 30 天'],
        ['90d', '近 90 天'],
        ['all', '全部时间']
    ];
    var _modelList = [];
    function modelOpts() {
        return _modelList.map(function (m) { return '<option value="' + esc(m) + '"' + (m === CUR.model ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('');
    }
    function rangeOpts() {
        return RANGES.map(function (r) { return '<option value="' + r[0] + '"' + (r[0] === CUR.range ? ' selected' : '') + '>' + r[1] + '</option>'; }).join('');
    }

    function renderDetail(el, data) {
        var rows = (data.rows || []).map(function (r) {
            return '<tr>'
                + '<td style="white-space:nowrap;color:#89a">' + esc(r.time) + '</td>'
                + '<td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(r.model) + '">' + esc(r.model || '(未知)') + '</td>'
                + '<td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + esc(r.session_title) + '">' + esc(r.session_title || '-') + '</td>'
                + '<td style="text-align:right">' + fmtN(r.pt) + '</td>'
                + '<td style="text-align:right">' + fmtN(r.ct) + '</td>'
                + '<td style="text-align:right;color:#7a7">' + fmtN(r.ck) + '</td>'
                + '<td style="text-align:right"><b>' + fmtN(r.tt) + '</b></td>'
                + '<td style="text-align:right;color:#89a">' + fmtT(r.duration_ms) + '</td>'
                + '<td style="text-align:center">' + (r.status === 'error' ? '<span style="color:#e66">失败</span>' : '<span style="color:#7a7">ok</span>') + '</td>'
                + '</tr>';
        }).join('');
        var pages = data.pages || 1;
        el.innerHTML =
            '<div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:14px 0 8px">'
            + '<span style="font-weight:600;font-size:13px">模型明细</span>'
            + '<select data-tud-range style="background:#1a1f2a;color:#dde;border:1px solid #334;border-radius:6px;padding:3px 8px;font-size:12px">' + rangeOpts() + '</select>'
            + '<select data-tud-model style="background:#1a1f2a;color:#dde;border:1px solid #334;border-radius:6px;padding:3px 8px;font-size:12px;max-width:180px">'
            + '<option value="">全部模型</option>' + modelOpts() + '</select>'
            + '<input data-tud-q placeholder="搜索模型/会话/box" value="' + esc(CUR.q) + '" style="background:#1a1f2a;color:#dde;border:1px solid #334;border-radius:6px;padding:3px 8px;font-size:12px;width:150px">'
            + '<span style="color:#667;font-size:11px">' + (data.sum_calls || 0) + ' 次调用 · 共 ' + fmtN(data.sum_tokens) + ' tokens（缓存 ' + fmtN(data.sum_cached) + '）</span>'
            + '</div>'
            + '<div style="overflow:auto;max-height:360px;border:1px solid rgba(255,255,255,.06);border-radius:8px">'
            + '<table style="width:100%;border-collapse:collapse;font-size:12px">'
            + '<thead><tr style="position:sticky;top:0;background:#151a24;color:#89a;text-align:left">'
            + '<th style="padding:6px 8px">时间</th><th style="padding:6px 8px">模型</th><th style="padding:6px 8px">会话</th>'
            + '<th style="padding:6px 8px;text-align:right">输入</th><th style="padding:6px 8px;text-align:right">输出</th>'
            + '<th style="padding:6px 8px;text-align:right">缓存</th><th style="padding:6px 8px;text-align:right">合计</th>'
            + '<th style="padding:6px 8px;text-align:right">耗时</th><th style="padding:6px 8px;text-align:center">状态</th>'
            + '</tr></thead><tbody>' + (rows || '<tr><td colspan="9" style="padding:14px;color:#667">暂无数据</td></tr>') + '</tbody></table></div>'
            + '<div style="display:flex;align-items:center;gap:8px;margin-top:6px;font-size:12px;color:#89a">'
            + '<button data-tud-prev ' + (CUR.page <= 1 ? 'disabled' : '') + ' style="background:#1a1f2a;color:#dde;border:1px solid #334;border-radius:6px;padding:3px 10px;cursor:pointer">上一页</button>'
            + '<span>第 ' + CUR.page + ' / ' + pages + ' 页（共 ' + (data.total || 0) + ' 条）</span>'
            + '<button data-tud-next ' + (CUR.page >= pages ? 'disabled' : '') + ' style="background:#1a1f2a;color:#dde;border:1px solid #334;border-radius:6px;padding:3px 10px;cursor:pointer">下一页</button>'
            + '</div>';
        bindEvents(el);
    }

    function bindEvents(el) {
        var q = el.querySelector('[data-tud-q]');
        var qTimer = null;
        if (q) q.addEventListener('input', function () {
            clearTimeout(qTimer);
            qTimer = setTimeout(function () { CUR.q = q.value.trim(); CUR.page = 1; load(el); }, 350);
        });
        var rg = el.querySelector('[data-tud-range]');
        if (rg) rg.addEventListener('change', function () { CUR.range = rg.value; CUR.page = 1; load(el); });
        var mo = el.querySelector('[data-tud-model]');
        if (mo) mo.addEventListener('change', function () { CUR.model = mo.value; CUR.page = 1; load(el); });
        var prev = el.querySelector('[data-tud-prev]');
        if (prev) prev.addEventListener('click', function () { if (CUR.page > 1) { CUR.page--; load(el); } });
        var next = el.querySelector('[data-tud-next]');
        if (next) next.addEventListener('click', function () { CUR.page++; load(el); });
    }

    var _loading = false;
    function load(el) {
        if (_loading) return;
        _loading = true;
        var url = '/api/usage/detail?page=' + CUR.page + '&page_size=' + pageSize
            + '&range=' + encodeURIComponent(CUR.range)
            + (CUR.model ? '&model=' + encodeURIComponent(CUR.model) : '')
            + (CUR.q ? '&q=' + encodeURIComponent(CUR.q) : '');
        fetch(url).then(function (r) { return r.json(); }).then(function (j) {
            if (j && j.ok) renderDetail(el, j);
        }).catch(function () {}).finally(function () { _loading = false; });
    }

    // 主面板渲染完后调用：把明细渲染到内联容器
    window.__tuRenderInlineDetail = function (el) {
        if (!el) return;
        try {
            var app = window.App || {};
            var d = app.__tuData;
            if (d && d.by_model) _modelList = d.by_model.map(function (m) { return m.model; }).filter(Boolean);
        } catch (e) {}
        load(el);
    };
})();
