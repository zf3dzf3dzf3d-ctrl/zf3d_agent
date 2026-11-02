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
                var modelPart = k.split('|').pop().toLowerCase();
                // 模糊子串匹配仅对足够长的键生效（≥5字符），避免 zf-0 等短键误命中其他模型
                if (!lm || modelPart.length < 5) continue;
                if (lm.indexOf(modelPart) >= 0 || modelPart.indexOf(lm) >= 0) return DEFAULT_PRICES[k];
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

    // ===== 极简图表（自绘 SVG，无外部依赖，带动画）=====
    // barChart  柱状图（每日用量）：柱子从底部依次升起
    // stepChart 台阶图（每月合计）：台阶折线逐段绘制 + 面积淡入 + 数据点亮起
    var TU_CHART_SEQ = 0;
    function ensureChartAnimStyle() {
        if (document.getElementById('tuChartAnimStyle')) return;
        var st = document.createElement('style');
        st.id = 'tuChartAnimStyle';
        st.textContent =
            '@keyframes tuGrow{from{transform:scaleY(0)}to{transform:scaleY(1)}}' +
            '@keyframes tuFadeIn{from{opacity:0}to{opacity:1}}' +
            '@keyframes tuDraw{to{stroke-dashoffset:0}}' +
            '.tu-bar{transform-box:fill-box;transform-origin:bottom;animation:tuGrow .7s cubic-bezier(.2,.7,.3,1) both}' +
            '.tu-area{animation:tuFadeIn 1.1s ease .4s both}' +
            '.tu-dot{transform-box:fill-box;transform-origin:center;animation:tuFadeIn .4s ease both}';
        document.head.appendChild(st);
    }
    function chartGrid(W, H, pad, max, fmt) {
        var svg = '';
        for (var g = 1; g <= 3; g++) {
            var gy = H - pad - (H - pad * 2) * g / 3;
            svg += '<line x1="' + pad + '" y1="' + gy + '" x2="' + (W - pad) + '" y2="' + gy + '" stroke="rgba(255,255,255,.07)"/>'
                + '<text x="' + (pad - 4) + '" y="' + (gy + 3) + '" fill="#889" font-size="9" text-anchor="end">' + fmt(max * g / 3) + '</text>';
        }
        return svg;
    }
    // 补零：把缺失的日期补上 0 值，使柱状图覆盖完整区间（按月补整月，近31天模式补到今天）
    function fillZeroDays(list, labelKey, range) {
        list = list.slice().sort(function (a, b) { return String(a[labelKey]).localeCompare(String(b[labelKey])); });
        if (!list.length) return range === 'month' ? [] : list;
        var map = {};
        list.forEach(function (d) { map[d[labelKey]] = d; });
        var out = [];
        function parse(k) { return new Date(k + 'T00:00:00'); }
        function fmtD(dt) { return dt.toISOString().slice(0, 10); }
        function daysInMonth(k) {
            var p = k.split('-');
            return new Date(Number(p[0]), Number(p[1]), 0).getDate();
        }
        var start = String(list[0][labelKey]), end = String(list[list.length - 1][labelKey]);
        var i = 0, guard = 0;
        if (range === 'month') {
            var ym = start.slice(0, 7);
            for (var dnum = 1; dnum <= daysInMonth(ym); dnum++) {
                var key = ym + '-' + String(dnum).padStart(2, '0');
                out.push(map[key] || { tt: 0 });
                out[out.length - 1][labelKey] = key;
            }
            return out;
        }
        var cur = parse(start);
        var stop = new Date(); // 一直补到今天
        while (cur <= stop && guard++ < 62) {
            var k2 = fmtD(cur);
            var item = map[k2] || { tt: 0 };
            item[labelKey] = k2;
            out.push(item);
            cur.setDate(cur.getDate() + 1);
        }
        return out;
    }
    function barChart(el, data, valKey, labelKey) {
        if (!el) return;
        ensureChartAnimStyle();
        var W = Math.max(el.clientWidth || 600, 300), H = 180, pad = 30;
        var vals = data.map(function (d) { return Number(d[valKey]) || 0; });
        var max = Math.max.apply(null, vals.concat([1]));
        var n = Math.max(data.length, 1);
        var bw = Math.max((W - pad * 2) / n - 4, 2);
        var svg = ['<svg width="100%" viewBox="0 0 ' + W + ' ' + H + '" style="display:block">'];
        svg.push(chartGrid(W, H, pad, max, fmt));
        data.forEach(function (d, i) {
            var v = vals[i];
            var bh = Math.max((H - pad * 2) * v / max, v > 0 ? 2 : 0);
            var x = pad + i * ((W - pad * 2) / n) + 2;
            var y = H - pad - bh;
            var lbl = String(d[labelKey] || '').slice(5); // 日去年份 / 月去年份
            svg.push('<rect class="tu-bar" x="' + x + '" y="' + y + '" width="' + bw + '" height="' + bh + '" rx="2" fill="#4f8cff" opacity="0.85" style="animation-delay:' + (i * 18) + 'ms"><title>' + (d[labelKey] || '') + ': ' + fmt(v) + ' tokens</title></rect>');
            if (n <= 32 || i % Math.ceil(n / 16) === 0) {
                svg.push('<text x="' + (x + bw / 2) + '" y="' + (H - pad + 12) + '" fill="#889" font-size="9" text-anchor="middle">' + lbl + '</text>');
            }
        });
        svg.push('</svg>');
        el.innerHTML = svg.join('');
    }
    // 补零：月份列表只补有数据的第一月起（目前只有统计开始当月），避免拉出一长串空月
    function fillZeroMonths(list, labelKey) {
        return list; // 现阶段仅一个月数据，保持原样；将来跨月后可在此补中间月
    }
    function stepChart(el, data, valKey, labelKey) {
        if (!el) return;
        ensureChartAnimStyle();
        var W = Math.max(el.clientWidth || 600, 300), H = 180, pad = 30;
        var vals = data.map(function (d) { return Number(d[valKey]) || 0; });
        var max = Math.max.apply(null, vals.concat([1]));
        var n = Math.max(data.length, 1);
        var step = (W - pad * 2) / n;
        var base = H - pad;
        if (!data.length) { el.innerHTML = '<div style="color:#889;padding:24px;text-align:center">暂无月度数据</div>'; return; }
        // 真台阶：每月一段水平线，月末一条竖线跳到下月高度
        var path = '', dots = [];
        vals.forEach(function (v, i) {
            var y = base - Math.max((H - pad * 2) * v / max, v > 0 ? 2 : 0);
            var x0 = pad + i * step, x1 = x0 + step;
            path += (i === 0 ? 'M' + x0 + ' ' + y : 'L' + x0 + ' ' + y) + 'H' + x1;
            dots.push({ x: (x0 + x1) / 2, y: y, v: v, lbl: String(data[i][labelKey] || '') });
        });
        var areaPath = path + 'L' + (W - pad) + ' ' + base + 'L' + pad + ' ' + base + 'Z';
        var uid = 'tuStepG' + (++TU_CHART_SEQ);
        var svg = ['<svg width="100%" viewBox="0 0 ' + W + ' ' + H + '" style="display:block">'];
        svg.push('<defs><linearGradient id="' + uid + '" x1="0" y1="0" x2="0" y2="1">'
            + '<stop offset="0" stop-color="#4f8cff" stop-opacity=".35"/><stop offset="1" stop-color="#4f8cff" stop-opacity="0"/></linearGradient></defs>');
        svg.push(chartGrid(W, H, pad, max, fmt));
        svg.push('<path class="tu-area" d="' + areaPath + '" fill="url(#' + uid + ')"/>');
        // 折线生长动画（PPT 表格感）
        svg.push('<path d="' + path + '" fill="none" stroke="#4f8cff" stroke-width="2" pathLength="100"'
            + ' style="stroke-dasharray:100;stroke-dashoffset:100;animation:tuDraw 1.4s ease-out forwards"/>');
        dots.forEach(function (p, i) {
            svg.push('<circle class="tu-dot" cx="' + p.x + '" cy="' + p.y + '" r="3" fill="#4f8cff" style="animation-delay:' + (400 + i * 150) + 'ms"><title>' + p.lbl + ': ' + fmt(p.v) + ' tokens</title></circle>');
            if (n <= 16 || i % Math.ceil(n / 16) === 0) {
                svg.push('<text x="' + p.x + '" y="' + (base + 12) + '" fill="#889" font-size="9" text-anchor="middle">' + p.lbl.slice(0, 7) + '</text>');
            }
        });
        svg.push('</svg>');
        el.innerHTML = svg.join('');
    }

    function card(html) { return '<div class="tu-card">' + html + '</div>'; }

    // 【去重聚合】按模型名合并多行（不同通道/月份累计会重复出现同一模型），
    // token 用量求和；全部为 0 的行默认不显示（避免占位行刷屏）
    function aggregateModels(models) {
        var map = {}, order = [];
        (models || []).forEach(function (m) {
            var k = String(m.model || '(未知)');
            if (!map[k]) {
                map[k] = { model: k, provider: m.provider || '', pt: 0, ct: 0, ck: 0, tt: 0, calls: 0 };
                order.push(k);
            }
            var a = map[k];
            a.pt += Number(m.pt) || 0;
            a.ct += Number(m.ct) || 0;
            a.ck += Number(m.ck) || 0;
            a.tt += Number(m.tt) || 0;
            a.calls += Number(m.calls) || 0;
            if (m.provider && m.provider !== a.provider) a.provider = ''; // 多通道混用时不锁定 provider
        });
        var used = order.map(function (k) { return map[k]; })
            .filter(function (a) { return a.pt || a.ct || a.ck || a.tt || a.calls; });
        var zero = order.length - used.length;
        if (zero > 0 && !used.length) used = order.map(function (k) { return map[k]; }); // 全是 0 时兜底显示
        used._zeroSkipped = zero;
        return used;
    }

    function renderModelTable(models, prices) {
        models = aggregateModels(models);
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
        var note = models._zeroSkipped > 0 ? ' <span style="color:#667;font-size:11px;margin-left:6px">（已合并重复模型，隐藏 ' + models._zeroSkipped + ' 个无用量条目）</span>' : '';
        return note + '<table style="width:100%;border-collapse:collapse;font-size:12px">'
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

    // ===== 新版 mount：每小时/每天/每月可切换 + 通道堆叠柱状图（朱峰模型/本地模型/其他云端）=====
    var CH_COLORS = { zhufeng: '#7ee787', local: '#58a6ff', cloud: '#d2a8ff' };
    var CH_NAMES  = { zhufeng: '朱峰模型', local: '本地模型', cloud: '其他云端' };

    function groupRows(rows, keyName) {
        // 把 [{day/hour/month, channel, tt}] 聚合成 key -> {channel: tt}
        var map = {}, order = [];
        (rows || []).forEach(function (r) {
            var k = r[keyName];
            if (!map[k]) { map[k] = {}; order.push(k); }
            var ch = r.channel || 'cloud';
            if (ch === 'cloud') return; // 「其他云端」分类已去掉，不再单独展示
            map[k][ch] = (map[k][ch] || 0) + (Number(r.tt) || 0);
        });
        order.sort();
        return { keys: order, map: map };
    }

    // 堆叠柱状图：keys 为横轴，map[key]={ch:val}；带悬浮提示/动画
    function stackedChart(keys, map, channels, W, H, labelFmt) {
        ensureChartAnimStyle();
        var pad = { l: 46, r: 10, t: 10, b: 22 };
        var max = 0;
        keys.forEach(function (k) {
            var s = 0; channels.forEach(function (c) { s += map[k][c] || 0; });
            if (s > max) max = s;
        });
        if (max <= 0) max = 1;
        var iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
        var n = Math.max(keys.length, 1);
        var step = iw / n, bw = Math.min(step * 0.72, 26);
        var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block">';
        for (var g = 0; g <= 3; g++) {
            var gy = pad.t + ih - ih * g / 3;
            svg += '<line x1="' + pad.l + '" y1="' + gy + '" x2="' + (W - pad.r) + '" y2="' + gy + '" stroke="rgba(255,255,255,.07)"/>'
                + '<text x="' + (pad.l - 5) + '" y="' + (gy + 3) + '" fill="#889" font-size="9" text-anchor="end">' + fmt(max * g / 3) + '</text>';
        }
        var seq = 0;
        keys.forEach(function (k, i) {
            var x = pad.l + step * i + (step - bw) / 2;
            var yBase = pad.t + ih, yTop = yBase;
            channels.forEach(function (c) {
                var v = map[k][c] || 0;
                if (v <= 0) return;
                var h = ih * v / max;
                yTop -= h;
                svg += '<rect class="tu-bar" x="' + x + '" y="' + yTop + '" width="' + bw + '" height="' + h + '" rx="2" fill="' + CH_COLORS[c] + '" opacity=".85" style="animation-delay:' + (seq * 0.02) + 's"><title>' + labelFmt(k) + ' · ' + CH_NAMES[c] + '：' + fmt(v) + '</title></rect>';
                seq++;
            });
            var lbEvery = Math.ceil(n / Math.floor(iw / 42));
            if (i % lbEvery === 0) {
                svg += '<text x="' + (x + bw / 2) + '" y="' + (H - 7) + '" fill="#889" font-size="9" text-anchor="middle">' + labelFmt(k) + '</text>';
            }
        });
        svg += '</svg>';
        return svg;
    }

    function chLegend(channels, active) {
        return channels.map(function (c) {
            var on = active.indexOf(c) >= 0;
            return '<span data-tuch="' + c + '" style="cursor:pointer;display:inline-flex;align-items:center;gap:4px;margin-right:12px;font-size:12px;opacity:' + (on ? 1 : .35) + '">'
                + '<i style="width:10px;height:10px;border-radius:2px;background:' + CH_COLORS[c] + ';display:inline-block"></i>' + CH_NAMES[c] + '</span>';
        }).join('');
    }

    function mount(root) {
        if (!root) return;
        var state = { days: 31, month: '', data: null, view: 'day', month2: '', ch: ['zhufeng', 'local'] };
        root.innerHTML = '<div style="color:#889;padding:24px;text-align:center">加载中…</div>';

        state.render = function () {
            if (!state.data) return;
            var d = state.data, prices = loadPrices();
            var t = d.total || {};
            var now = new Date();
            var today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0'); // 本地日期，与后端 localtime 口径一致
            var todayTok = 0;
            (d.daily || []).forEach(function (r) { if (r.day === today) todayTok += (Number(r.tt) || 0); });
            var totalCost = 0, monthCost = 0, todayCost = 0;
            (d.by_model || []).forEach(function (m) { totalCost += calcCost(m, prices); });
            var md = (d.month_detail && d.month_detail.by_model) || [];
            md.forEach(function (m) { monthCost += calcCost(m, prices); });
            (d.today_by_model || []).forEach(function (m) { todayCost += calcCost(m, prices); });
            // 活跃天数：近 N 天里有实际用量记录的天数（分母用活跃天数而非固定窗口，避免刚启用时月均预估严重偏小）
            var activeDays = 0;
            (d.daily || []).forEach(function (r) { if ((Number(r.tt) || 0) > 0) activeDays++; });
            var monthAvgCost = totalCost / Math.max(1, activeDays) * 30;

            var html = ''
                + '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px">'
                + card('<div style="color:#889;font-size:11px">今日 Token</div><div style="font-size:20px;font-weight:700">' + fmt(todayTok) + '</div>')
                + card('<div style="color:#889;font-size:11px">今日估算花销</div><div style="font-size:20px;font-weight:700;color:#7ee787">' + fmtCost(todayCost) + '</div>')
                + card('<div style="color:#889;font-size:11px">近' + state.days + '天合计</div><div style="font-size:20px;font-weight:700">' + fmt(t.tt) + '</div>')
                + card('<div style="color:#889;font-size:11px">全部调用次数</div><div style="font-size:20px;font-weight:700">' + fmt(t.calls) + '</div>')
                + card('<div style="color:#889;font-size:11px">本月估算花销</div><div style="font-size:20px;font-weight:700;color:#7ee787">' + fmtCost(monthCost) + '</div>')
                + card('<div style="color:#889;font-size:11px">月均预估(日均×30)</div><div style="font-size:20px;font-weight:700;color:#d2a8ff">' + fmtCost(monthAvgCost) + '</div>')
                + card('<div style="color:#889;font-size:11px">累计估算花销</div><div style="font-size:20px;font-weight:700;color:#7ee787">' + fmtCost(totalCost) + '</div>')
                + '</div>';

            // ===== 图表区：视图切换（每小时 / 每天 / 每月）=====
            var vBtn = function (v, label) {
                var on = state.view === v;
                return '<button data-tuv="' + v + '" style="padding:4px 14px;border-radius:14px;border:1px solid ' + (on ? '#7ee787' : '#334') + ';background:' + (on ? 'rgba(126,231,135,.15)' : 'transparent') + ';color:' + (on ? '#7ee787' : '#889') + ';font-size:12px;cursor:pointer">' + label + '</button>';
            };
            html += '<div style="margin-bottom:8px;display:flex;align-items:center;flex-wrap:wrap;gap:8px">'
                + '<span style="font-weight:600;font-size:13px;margin-right:6px">用量趋势</span>'
                + vBtn('hour', '每小时') + vBtn('day', '每天') + vBtn('month', '每月')
                + '<span style="margin-left:auto"></span>' + chLegend(['zhufeng', 'local'], state.ch)
                + '</div>';

            var svgChart = '', subInfo = '';
            if (state.view === 'day') {
                var gd = groupRows(d.daily, 'day');
                var keys = [];
                for (var i = state.days - 1; i >= 0; i--) {
                    var dt = new Date(Date.now() - i * 86400000);
                    keys.push(dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0'));
                }
                var map = {};
                keys.forEach(function (k) { map[k] = gd.map[k] || {}; });
                svgChart = stackedChart(keys, map, state.ch, 760, 240, function (k) { return k.slice(5); });
                subInfo = '近 ' + state.days + ' 天 · 每日堆叠';
            } else if (state.view === 'hour') {
                var gh = groupRows(d.hourly, 'hour');
                var hk = gh.keys.slice(-48); // 最多显示 48 小时
                var hm = {}; hk.forEach(function (k) { hm[k] = gh.map[k]; });
                svgChart = stackedChart(hk, hm, state.ch, 760, 240, function (k) { return k.slice(11, 13) + '时'; });
                subInfo = '近 48 小时 · 每小时堆叠';
            } else {
                var gm = groupRows(d.monthly, 'month');
                var mk = gm.keys;
                var mm = {}; mk.forEach(function (k) { mm[k] = gm.map[k]; });
                svgChart = stackedChart(mk, mm, state.ch, 760, 240, function (k) { return k; });
                subInfo = '按月堆叠（近 36 个月内）';
            }
            html += '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:10px;padding:10px 6px 4px;margin-bottom:14px">'
                + svgChart
                + '<div style="color:#667;font-size:11px;padding:4px 10px">' + subInfo + ' · 点击图例可过滤通道</div></div>';

            // ===== 模型明细：直接展示最近调用明细（可翻页 + 时间范围下拉），由 panel-token-usage-detail.js 渲染 =====
            html += '<div id="tuDetailInline"><div style="color:#667;font-size:11px;padding:14px;text-align:center">明细加载中…</div></div>';

            root.innerHTML = html;

            // 事件绑定
            root.querySelectorAll('[data-tuv]').forEach(function (b) {
                b.addEventListener('click', function () { state.view = b.getAttribute('data-tuv'); state.render(); });
            });
            root.querySelectorAll('[data-tuch]').forEach(function (lg) {
                lg.addEventListener('click', function () {
                    var c = lg.getAttribute('data-tuch');
                    var ix = state.ch.indexOf(c);
                    if (ix >= 0) { if (state.ch.length > 1) state.ch.splice(ix, 1); } else { state.ch.push(c); }
                    state.render();
                });
            });
            var ms = root.querySelector('[data-tumonth]');
            if (ms) ms.addEventListener('change', function () {
                state.month2 = ms.value;
                var self = state;
                fetch('/api/usage/tokens?days=' + state.days + '&month=' + ms.value)
                    .then(function (r) { return r.json(); })
                    .then(function (j) { if (j && j.month_detail) { self.data.month_detail = j.month_detail; self.render(); } })
                    .catch(function () {});
            });
            // 渲染完后：把明细注入内嵌位置（若无独立明细模块则直接在此渲染）
            var inline = root.querySelector('#tuDetailInline');
            if (inline && window.__tuRenderInlineDetail) {
                window.__tuRenderInlineDetail(inline);
            } else if (inline && typeof window.__tuDetailEnsure === 'function') {
                window.__tuDetailEnsure(inline);
            }
            bindPriceInputs(root, state);
        };

        state.load = function () {
            if (!state.month) {
                var n0 = new Date();
                state.month = n0.getFullYear() + '-' + String(n0.getMonth() + 1).padStart(2, '0'); // 默认查当月，保证本月花销有数据
            }
            var url = '/api/usage/tokens?days=' + state.days + (state.month ? '&month=' + state.month : '');
            fetch(url).then(function (r) { return r.json(); }).then(function (j) {
                state.data = j || {};
                if (!state.month2) {
                    var cur = new Date().toISOString().slice(0, 7);
                    var ms0 = (state.data.monthly || []).map(function (m) { return m.month; }).filter(Boolean);
                    state.month2 = ms0.indexOf(cur) >= 0 ? cur : (ms0[0] || cur);
                }
                state.render();
            }).catch(function (e) {
                root.innerHTML = '<div style="color:#f88;padding:20px">加载失败：' + e + '</div>';
            });
        };
        state.load();
    }

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
