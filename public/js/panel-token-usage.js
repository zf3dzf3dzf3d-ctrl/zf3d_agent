// -*- coding: utf-8 -*-
// Token 用量统计面板（设置面板卡片式 Tab：📊 Token 统计）
// 数据源：GET /api/usage/tokens?days=31&month=YYYY-MM
// 功能：总览卡片 / 每日台阶柱状图 / 每月台阶柱状图 / 查询指定月份 / 按模型花销核算
(function () {
    'use strict';

    // 单价表（元 / 百万token），localStorage 持久化，key 为 provider|model
    var PRICE_KEY = 'zf_token_prices_v1';
    var DEFAULT_PRICES = null; // 默认价表，来自 token-prices.json
    (function () {
        try {
            fetch('js/token-prices.json', { cache: 'no-cache' })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (j) {
                    if (!j) return;
                    var out = {};
                    Object.keys(j).forEach(function (k) {
                        if (k.charAt(0) === '_') return;
                        out[k] = j[k]; out['|' + k] = j[k];
                    });
                    DEFAULT_PRICES = out;
                    document.dispatchEvent(new CustomEvent('zf-default-prices-loaded'));
                })
                .catch(function () {});
        } catch (e) {}
    })();

    function lookupPrice(prices, m) {
        var exact = prices[priceKey(m)];
        if (exact) return exact;
        var nameOnly = prices['|' + (m.model || '')];
        if (nameOnly) return nameOnly;
        if (DEFAULT_PRICES) {
            var d1 = DEFAULT_PRICES[priceKey(m)];
            if (d1) return d1;
            var d2 = DEFAULT_PRICES['|' + (m.model || '')];
            if (d2) return d2;
            var lm = String(m.model || '').toLowerCase();
            for (var k in DEFAULT_PRICES) {
                if (lm && (lm.indexOf(k.toLowerCase()) >= 0 || k.toLowerCase().indexOf(lm) >= 0)) return DEFAULT_PRICES[k];
            }
        }
        return null;
    }

    function loadPrices() {
        try { return JSON.parse(localStorage.getItem(PRICE_KEY) || '{}'); } catch (e) { return {}; }
    }
    function savePrices(p) {
        try { localStorage.setItem(PRICE_KEY, JSON.stringify(p)); } catch (e) {}
    }
    function priceKey(m) { return (m.provider || '') + '|' + (m.model || ''); }

    function fmt(n) {
        n = Number(n) || 0;
        if (n >= 1e8) return (n / 1e8).toFixed(2) + '亿';
        if (n >= 1e4) return (n / 1e4).toFixed(2) + '万';
        return String(n);
    }
    function fmtCost(n) { return '¥' + (Number(n) || 0).toFixed(2); }

    // 用量花费：分输入/输出两段计价（输入含缓存命中部分可单独定价，缺省同输入价）
    function calcCost(m, prices) {
        var p = lookupPrice(prices, m) || {};
        var pin = Number(p.in) || 0, pout = Number(p.out) || 0, pcache = (p.cache !== undefined && p.cache !== '') ? Number(p.cache) : pin;
        // prompt_tokens 是总输入（含缓存命中），cached 部分按缓存价，其余按输入价
        var cached = Number(m.ck) || 0;
        var pinTokens = Math.max(0, (Number(m.pt) || 0) - cached);
        return (pinTokens / 1e6) * pin + (cached / 1e6) * pcache + ((Number(m.ct) || 0) / 1e6) * pout;
    }

    // ===== 极简台阶柱状图（自绘 SVG，无外部依赖）=====
    function barChart(el, data, valKey, labelKey) {
        if (!el) return;
        var W = Math.max(el.clientWidth || 600, 300), H = 180, pad = 30;
        var vals = data.map(function (d) { return Number(d[valKey]) || 0; });
        var max = Math.max.apply(null, vals.concat([1]));
        var n = Math.max(data.length, 1);
        var bw = Math.max((W - pad * 2) / n - 4, 2);
        var svg = ['<svg width="100%" viewBox="0 0 ' + W + ' ' + H + '" style="display:block">'];
        // 网格线
        for (var g = 1; g <= 3; g++) {
            var gy = H - pad - (H - pad * 2) * g / 3;
            svg.push('<line x1="' + pad + '" y1="' + gy + '" x2="' + (W - pad) + '" y2="' + gy + '" stroke="rgba(255,255,255,.07)"/>');
            svg.push('<text x="' + (pad - 4) + '" y="' + (gy + 3) + '" fill="#889" font-size="9" text-anchor="end">' + fmt(max * g / 3) + '</text>');
        }
        data.forEach(function (d, i) {
            var v = vals[i];
            var bh = Math.max((H - pad * 2) * v / max, v > 0 ? 2 : 0);
            var x = pad + i * ((W - pad * 2) / n) + 2;
            var y = H - pad - bh;
            var lbl = String(d[labelKey] || '').slice(5); // 日去掉年份 / 月去掉年份
            svg.push('<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + bh + '" rx="2" fill="#4f8cff" opacity="0.85"><title>' + (d[labelKey] || '') + ': ' + fmt(v) + ' tokens</title></rect>');
            if (n <= 32 || i % Math.ceil(n / 16) === 0) {
                svg.push('<text x="' + (x + bw / 2) + '" y="' + (H - pad + 12) + '" fill="#889" font-size="9" text-anchor="middle">' + lbl + '</text>');
            }
        });
        svg.push('</svg>');
        el.innerHTML = svg.join('');
    }

    function card(html) { return '<div class="tu-card">' + html + '</div>'; }

    function renderModelTable(models, prices) {
        var rows = models.map(function (m) {
            var key = priceKey(m);
            var p = lookupPrice(prices, m) || {};
            return '<tr>'
                + '<td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + m.model + '">' + (m.model || '(未知)') + '</td>'
                + '<td>' + fmt(m.pt) + '</td><td>' + fmt(m.ct) + '</td><td>' + fmt(m.ck) + '</td><td><b>' + fmt(m.tt) + '</b></td>'
                + '<td style="white-space:nowrap"><input type="number" step="any" placeholder="输入价" value="' + (p.in != null ? p.in : '') + '" data-tup="' + key + '" data-tuk="in" style="width:70px;background:#1b1e27;color:#dde;border:1px solid #333;border-radius:4px;padding:2px 4px"> / '
                + '<input type="number" step="any" placeholder="输出价" value="' + (p.out != null ? p.out : '') + '" data-tup="' + key + '" data-tuk="out" style="width:70px;background:#1b1e27;color:#dde;border:1px solid #333;border-radius:4px;padding:2px 4px"></td>'
                + '<td><b>' + fmtCost(calcCost(m, prices)) + '</b></td>'
                + '</tr>';
        }).join('');
        return '<table style="width:100%;border-collapse:collapse;font-size:12px">'
            + '<thead><tr style="color:#889;text-align:left">'
            + '<th>模型</th><th>输入</th><th>输出</th><th>缓存命中</th><th>合计</th><th>单价(元/百万tok)</th><th>花费</th></tr></thead>'
            + '<tbody>' + (rows || '<tr><td colspan="7" style="color:#667;padding:12px">暂无数据</td></tr>') + '</tbody></table>';
    }

    function bindPriceInputs(root, state) {
        root.querySelectorAll('input[data-tup]').forEach(function (inp) {
            inp.addEventListener('change', function () {
                var prices = loadPrices();
                var key = inp.getAttribute('data-tup'), k = inp.getAttribute('data-tuk');
                prices[key] = prices[key] || {};
                prices[key][k] = inp.value === '' ? null : Number(inp.value);
                savePrices(prices);
                state.render();
            });
        });
    }

    function mount(root) {
        if (!root) return;
        var state = { days: 31, month: '', data: null };
        root.innerHTML = '<div style="color:#889;padding:24px;text-align:center">加载中…</div>';

        state.render = function () {
            if (!state.data) return;
            var d = state.data, prices = loadPrices();
            var t = d.total || {};
            // 汇总卡片
            var today = new Date().toISOString().slice(0, 10);
            var todayTok = 0;
            (d.daily || []).forEach(function (r) { if (r.day === today) todayTok = r.tt; });
            var totalCost = 0, monthCost = 0;
            (d.by_model || []).forEach(function (m) { totalCost += calcCost(m, prices); });
            var md = (d.month_detail && d.month_detail.by_model) || [];
            md.forEach(function (m) { monthCost += calcCost(m, prices); });

            var html = ''
                + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px">'
                + card('<div style="color:#889;font-size:11px">今日 Token</div><div style="font-size:20px;font-weight:700">' + fmt(todayTok) + '</div>')
                + card('<div style="color:#889;font-size:11px">近' + state.days + '天合计</div><div style="font-size:20px;font-weight:700">' + fmt(t.tt) + '</div>')
                + card('<div style="color:#889;font-size:11px">全部调用次数</div><div style="font-size:20px;font-weight:700">' + fmt(t.calls) + '</div>')
                + card('<div style="color:#889;font-size:11px">本月估算花销</div><div style="font-size:20px;font-weight:700;color:#7ee787">' + fmtCost(monthCost) + '</div>')
                + card('<div style="color:#889;font-size:11px">累计估算花销</div><div style="font-size:20px;font-weight:700;color:#7ee787">' + fmtCost(totalCost) + '</div>')
                + '</div>';

            // 月份选择 + 每日/每月图
            var months = (d.monthly || []).map(function (m) { return m.month; });
            var curMonth = state.month || months[0] || new Date().toISOString().slice(0, 7);
            var opts = months.map(function (m) {
                return '<option value="' + m + '"' + (m === curMonth ? ' selected' : '') + '>' + m + '</option>';
            }).join('');
            html += '<div style="display:flex;gap:10px;align-items:center;margin:6px 0">'
                + '<b style="font-size:13px">每日用量' + (curMonth ? '（' + curMonth + '）' : '') + '</b>'
                + (opts ? '<select id="tuMonthSel" style="background:#1b1e27;color:#dde;border:1px solid #333;border-radius:6px;padding:4px 8px">' + opts + '</select>' : '')
                + '<span style="color:#667;font-size:11px">查询上一个月可选月份下拉</span></div>'
                + '<div id="tuDailyChart" style="background:rgba(255,255,255,.02);border-radius:8px;padding:6px"></div>';

            html += '<div style="margin:14px 0 6px"><b style="font-size:13px">每月合计（台阶图）</b></div>'
                + '<div id="tuMonthChart" style="background:rgba(255,255,255,.02);border-radius:8px;padding:6px"></div>';

            html += '<div style="margin:14px 0 6px"><b style="font-size:13px">按模型核算</b>'
                + '<span style="color:#667;font-size:11px;margin-left:8px">填单价（元/百万token）自动算花销，保存在本机</span></div>'
                + '<div style="overflow-x:auto">' + renderModelTable(md.length ? md : (d.by_model || []), prices) + '</div>';

            root.innerHTML = html;
            barChart(document.getElementById('tuDailyChart'), (d.month_detail && d.month_detail.daily) || [], 'tt', 'day');
            barChart(document.getElementById('tuMonthChart'), (d.monthly || []).slice().reverse(), 'tt', 'month');
            var sel = document.getElementById('tuMonthSel');
            if (sel) sel.addEventListener('change', function () {
                state.month = sel.value;
                state.load();
            });
            bindPriceInputs(root, state);
        };

        state.load = function () {
            var url = '/api/usage/tokens?days=' + state.days + (state.month ? '&month=' + state.month : '');
            fetch(url).then(function (r) { return r.json(); }).then(function (j) {
                if (!j || !j.ok) throw new Error((j && j.err) || '加载失败');
                state.data = j;
                if (!state.month && j.monthly && j.monthly.length) state.month = j.monthly[0].month;
                if (state.month && j.month_detail && j.month_detail.month !== state.month) {
                    // 换月后补拉该月明细
                    fetch('/api/usage/tokens?days=' + state.days + '&month=' + state.month)
                        .then(function (r) { return r.json(); })
                        .then(function (j2) { if (j2 && j2.ok) { state.data = j2; state.render(); } })
                        .catch(function () { state.render(); });
                    return;
                }
                state.render();
            }).catch(function (e) {
                root.innerHTML = '<div style="color:#a66;padding:24px;text-align:center">加载失败：' + e.message + '</div>';
            });
        };
        state.load();
    }

    // ===== 挂到设置面板 Tab 切换 =====
    function init() {
        if (!window.App || typeof window.App.switchSettingsTab !== 'function') {
            setTimeout(init, 300);
            return;
        }
        if (window.App.__tuPatched) return;
        window.App.__tuPatched = true;
        var orig = window.App.switchSettingsTab.bind(window.App);
        window.App.switchSettingsTab = function (tab) {
            orig(tab);
            if (String(tab) === 'tokenusage') {
                var root = document.getElementById('tokenUsageMount');
                if (root && !root.dataset.tuInit) {
                    root.dataset.tuInit = '1';
                    mount(root);
                } else if (root && root.dataset.tuInit === 'refresh') {
                    mount(root);
                }
            }
        };
    }
    init();
})();
