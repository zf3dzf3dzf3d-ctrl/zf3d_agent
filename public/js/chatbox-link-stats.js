/* ============================================================
 * chatbox-link-stats.js —— 对话框头部「大模型链路状态」徽章
 *
 * 功能：显示当前对话所用大模型的连通状态 + 首字延迟 + 生成速率
 *   ● 350ms · 42 tok/s   绿=通
 *   ● 失败/超时          红=不通
 *   ● 未测               灰=该模型从未发起过请求
 *
 * 性能设计（按用户要求：关闭不统计、打开也不高频）：
 *   - 数据来源是服务器在真实对话请求中被动记录的统计（零额外上游流量）
 *   - 前端仅每 30 秒拉一次 /api/model-link-stats（且仅在存在打开的对话框时）
 *   - 设置开关 model_link_stats.enabled=false 时徽章隐藏、不再拉取
 *   - 悬停显示最近 5 轮明细
 * ============================================================ */
(function () {
    'use strict';

    var POLL_MS = 30000;          // 30 秒一次（用户要求：不需要太频繁）
    var CACHE_TTL = 15000;
    var _timer = null;
    var _cache = null;            // {ts, data}
    var _enabled = null;          // null=未读取过设置

    function fetchStats(cb) {
        if (_cache && (Date.now() - _cache.ts) < CACHE_TTL) { cb(_cache.data); return; }
        fetch('/api/model-link-stats')
            .then(function (r) { return r.json(); })
            .then(function (j) {
                _cache = { ts: Date.now(), data: (j && j.ok) ? j.data : null };
                // 开关随接口实时下发：关掉后端立即停统计，前端据此隐藏徽章
                if (typeof j.enabled === 'boolean') _enabled = j.enabled;
                cb(_cache.data);
            })
            .catch(function () { cb(null); });
    }

    function fmtBadge(s) {
        if (!s || s.state === 'unknown') {
            return { cls: 'ls-unknown', text: '未测', tip: '该模型尚未发起过对话，暂无链路数据' };
        }
        if (s.state === 'fail') {
            return { cls: 'ls-fail', text: '不通',
                     tip: '上次请求失败' + (s.err ? ('：' + s.err) : '') };
        }
        var parts = [];
        if (s.ttft_ms != null) parts.push(Math.round(s.ttft_ms) + 'ms');
        if (s.tps != null) parts.push(s.tps + ' tok/s');
        var tip = '链路正常';
        if (s.last_ts) tip += '\n上次测量：' + new Date(s.last_ts * 1000).toLocaleTimeString();
        var recent = (s.recent || []).map(function (e) {
            return (e.ok ? '✓' : '✗') + ' ' +
                (e.ttft_ms != null ? Math.round(e.ttft_ms) + 'ms' : '-') + ' · ' +
                (e.tps != null ? e.tps + ' t/s' : '-');
        }).join('\n');
        if (recent) tip += '\n最近5轮：\n' + recent;
        return { cls: 'ls-ok', text: parts.join(' · ') || '正常', tip: tip };
    }

    function currentModel() {
        // 尝试从激活对话框读取当前模型名（多种可能的选择器，逐个试）
        var box = document.querySelector('.chatbox:not([style*="display: none"]) .model-select, ' +
                                         '.chatbox .model-select');
        if (box) {
            if (box.value) return box.value;
            var opt = box.querySelector('option:checked');
            if (opt) return opt.textContent.trim();
        }
        return null;
    }

    function render() {
        if (_enabled === false) { window.__kho2LinkStatHtml = null; updatePanel(); return; }
        fetchStats(function (data) {
            if (!data) { updatePanel(); return; }
            var model = currentModel();
            var keys = model ? [model] : Object.keys(data);
            // 取指定模型；没有就取最近更新的一个
            var s = null;
            for (var i = 0; i < keys.length; i++) { if (data[keys[i]]) { s = data[keys[i]]; break; } }
            if (!s) {
                var best = 0;
                Object.keys(data).forEach(function (k) {
                    if (data[k].last_ts && data[k].last_ts > best) { best = data[k].last_ts; s = data[k]; }
                });
            }
            if (!s) { updatePanel(); return; }
            var f = fmtBadge(s);
            // 供风筝头面板（app-kite.js）在面板重建时嵌入「大模型链路」行
            window.__kho2LinkStatHtml = '<div class="kho2-lstat ' + f.cls + '" id="kho2LinkStat" title="' +
                String(f.tip).replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '">' +
                '<span class="kho2-lstat__dot"></span><span class="kho2-lstat__txt">' + f.text + '</span></div>';
            updatePanel();
        });
    }

    // 面板已打开时立即把最新数据写进对应槽位（面板重建由 app-kite.js 的限频负责）
    function updatePanel() {
        var slot = document.getElementById('kho2LinkStat');
        if (slot) slot.outerHTML = window.__kho2LinkStatHtml || '<div class="kho2-empty" id="kho2LinkStat">链路统计关闭</div>';
    }

    function tick() {
        // 页面隐藏时跳过；面板开着时更新槽位，没开也不影响（只写变量，30秒一次）
        if (document.hidden) return;
        render();
    }

    function start() {
        if (_timer) return;
        // 先读一次开关（从服务器设置），失败按开启处理
        fetch('/api/settings')
            .then(function (r) { return r.json(); })
            .then(function (j) {
                try { _enabled = j.settings.model_link_stats.enabled !== false; }
                catch (e) { _enabled = true; }
            })
            .catch(function () { _enabled = true; });
        _timer = setInterval(tick, POLL_MS);
        setTimeout(tick, 2000); // 启动后 2 秒先刷一次
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }

    // 暴露给其他模块：对话发完消息后可调 App.refreshLinkStats() 立即刷新
    App.refreshLinkStats = function () { _cache = null; tick(); };
})();
