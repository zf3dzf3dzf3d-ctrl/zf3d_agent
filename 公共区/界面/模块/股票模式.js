/**
 * 股票模式 — 股票K线/分时/板块/资金/自选股/CSV/缓存
 * 从 逻辑.js 拆分
 */

// ============ 股票模式 ============
let stockModeActive = false;
let stockCurrentView = 'panel';
let stockRefreshTimer = null;
let stockCurrentCode = '';
let stockCurrentPeriod = 'daily';
let stockPanelPage = 1;
let stockSearchTimer = null;
let stockWatchlist = JSON.parse(localStorage.getItem('stockWatchlist') || '[]');

function toggleStockMode() {
    stockModeActive = !stockModeActive;
    const filesPanel = document.getElementById('filesPanel');
    const editorPanel = document.getElementById('editorPanel');
    const stockPanel = document.getElementById('stockPanel');
    const dividers = document.querySelectorAll('.divider');
    const btn = document.getElementById('stockModeBtn');

    if (stockModeActive) {
        // 隐藏文件面板和编辑器面板
        filesPanel.style.display = 'none';
        editorPanel.style.display = 'none';
        // 隐藏第一个分隔线（filesPanel↔editorPanel）
        if (dividers[0]) dividers[0].style.display = 'none';
        // 第二个分隔线改为 stockPanel↔chatPanel
        if (dividers[1]) dividers[1].dataset.left = 'stockPanel';
        // 显示股票面板（清理可能因拖拽折叠残留的 hidden 类）
        stockPanel.classList.remove('hidden');
        stockPanel.style.width = '';
        stockPanel.style.display = 'flex';
        stockPanel.style.flex = '1';
        btn.style.color = 'var(--blue)';
        btn.textContent = '📁';
        btn.title = '切换回文件夹模式';
        // 加载盘面数据
        renderWatchlist();
        switchStockView('panel');
    } else {
        // 恢复文件面板和编辑器面板
        filesPanel.style.display = 'flex';
        editorPanel.style.display = 'flex';
        if (dividers[0]) dividers[0].style.display = '';
        // 第二个分隔线恢复为 editorPanel↔chatPanel
        if (dividers[1]) dividers[1].dataset.left = 'editorPanel';
        // 清理可能因拖拽折叠残留的 hidden 类
        filesPanel.classList.remove('hidden');
        editorPanel.classList.remove('hidden');
        chatPanel.classList.remove('hidden');
        filesPanel.style.width = '';
        editorPanel.style.width = '';
        stockPanel.style.display = 'none';
        btn.style.color = '';
        btn.textContent = '📊';
        btn.title = '切换到股票模式';
        // 停止刷新
        if (stockRefreshTimer) { clearInterval(stockRefreshTimer); stockRefreshTimer = null; }
    }
}

function switchStockView(view) {
    stockCurrentView = view;
    // 更新标签高亮
    document.querySelectorAll('.stock-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.view === view);
    });
    // 切换视图显示
    const views = ['panel', 'kline', 'minute', 'sectors', 'flow', 'data'];
    views.forEach(v => {
        const el = document.getElementById('stockView' + v.charAt(0).toUpperCase() + v.slice(1));
        if (el) el.style.display = v === view ? 'block' : 'none';
    });

    // 停止之前的刷新
    if (stockRefreshTimer) { clearInterval(stockRefreshTimer); stockRefreshTimer = null; }

    if (view === 'panel') {
        loadStockPanel();
        stockRefreshTimer = setInterval(() => loadStockPanel(false, true), 15000);
    } else if (view === 'kline' && stockCurrentCode) {
        loadStockKline(stockCurrentCode);
    } else if (view === 'minute' && stockCurrentCode) {
        loadStockMinute(stockCurrentCode);
    } else if (view === 'sectors') {
        loadStockSectors();
    } else if (view === 'flow' && stockCurrentCode) {
        loadStockFlow(stockCurrentCode);
    } else if (view === 'data') {
        loadStockDataPanel();
    }
}

async function searchStock() {
    const input = document.getElementById('stockCodeInput');
    const val = input.value.trim();
    if (!val) return;
    // 隐藏联想下拉
    document.getElementById('stockSearchDropdown').style.display = 'none';
    // 纯数字 = 直接用代码
    if (/^\d{6}$/.test(val)) {
        stockCurrentCode = val;
    } else {
        // 名称/模糊搜索 → 取第一个结果
        try {
            const res = await fetch('/api/stock-search?q=' + encodeURIComponent(val));
            const d = await res.json();
            if (d.成功 && d.结果 && d.结果.length > 0) {
                stockCurrentCode = d.结果[0].代码;
                input.value = stockCurrentCode;
            } else {
                return;
            }
        } catch (e) { return; }
    }
    // 根据当前视图加载对应数据
    if (stockCurrentView === 'kline') {
        loadStockKline(stockCurrentCode);
    } else if (stockCurrentView === 'minute') {
        loadStockMinute(stockCurrentCode);
    } else if (stockCurrentView === 'flow') {
        loadStockFlow(stockCurrentCode);
    } else {
        switchStockView('kline');
    }
}

// 搜索联想
function onStockSearchInput() {
    clearTimeout(stockSearchTimer);
    const val = document.getElementById('stockCodeInput').value.trim();
    const dropdown = document.getElementById('stockSearchDropdown');
    if (!val || /^\d{6}$/.test(val)) { dropdown.style.display = 'none'; return; }
    stockSearchTimer = setTimeout(async () => {
        try {
            const res = await fetch('/api/stock-search?q=' + encodeURIComponent(val));
            const d = await res.json();
            if (!d.成功 || !d.结果 || d.结果.length === 0) { dropdown.style.display = 'none'; return; }
            let html = '';
            for (const r of d.结果.slice(0, 10)) {
                html += `<div class="ssd-item" onclick="selectStock('${r.代码}')">`;
                html += `<span class="ssd-code">${r.代码}</span><span class="ssd-name">${escapeHtml(r.名称)}</span></div>`;
            }
            dropdown.innerHTML = html;
            dropdown.style.display = 'block';
        } catch (e) { dropdown.style.display = 'none'; }
    }, 250);
}

function selectStock(code) {
    document.getElementById('stockCodeInput').value = code;
    document.getElementById('stockSearchDropdown').style.display = 'none';
    stockCurrentCode = code;
    if (stockCurrentView === 'kline') {
        loadStockKline(code);
    } else if (stockCurrentView === 'minute') {
        loadStockMinute(code);
    } else {
        switchStockView('kline');
    }
}

// 盘面列表
async function loadStockPanel(isAutoRefresh, isTimer) {
    const container = document.getElementById('stockViewPanel');
    if (!isAutoRefresh) container.innerHTML = '<div class="sp-loading">⏳ 加载盘面数据...</div>';
    try {
        const res = await fetch('/api/stock-panel?page=' + stockPanelPage);
        const d = await res.json();
        if (!d.成功) {
            container.innerHTML = '<div class="sp-loading">❌ ' + escapeHtml(d.错误 || '加载失败') + '</div>';
            return;
        }
        let html = '<div class="sp-refresh-bar">';
        html += '<div class="sp-idx-row">';
        for (const idx of (d.指数 || [])) {
            const cls = idx.涨跌幅 >= 0 ? 'sp-up' : 'sp-down';
            const arrow = idx.涨跌幅 >= 0 ? '▲' : '▼';
            html += `<span class="sp-idx" onclick="stockCurrentCode='${idx.代码}';switchStockView('kline')">${idx.名称} ${idx.最新价} <span class="${cls}">${arrow}${Math.abs(idx.涨跌幅).toFixed(2)}%</span></span>`;
        }
        html += '</div>';
        const cacheHit = d._缓存命中 ? '📦缓存' : '🌐实时';
        html += `<span class="sp-last-update">更新: ${d.时间 || ''} ${cacheHit}</span>`;
        html += '</div>';

        // 市场总览
        const br = d.市场总览 || {};
        if (br.上涨 !== undefined) {
            html += '<div class="sp-breadth">';
            html += `<div class="sb-item"><span class="sb-label">上涨</span><span class="sb-up">${br.上涨}</span></div>`;
            html += `<span class="sb-sep">|</span>`;
            html += `<div class="sb-item"><span class="sb-label">下跌</span><span class="sb-down">${br.下跌}</span></div>`;
            html += `<span class="sb-sep">|</span>`;
            html += `<div class="sb-item"><span class="sb-label">平盘</span><span class="sb-flat">${br.平盘}</span></div>`;
            html += `<span class="sb-sep">|</span>`;
            html += `<div class="sb-item"><span class="sb-label">涨停</span><span class="sb-up">${br.涨停}</span></div>`;
            html += `<span class="sb-sep">|</span>`;
            html += `<div class="sb-item"><span class="sb-label">跌停</span><span class="sb-down">${br.跌停}</span></div>`;
            html += '</div>';
        }

        // 涨幅榜
        html += '<table class="sp-table"><thead><tr>';
        html += '<th></th><th>代码</th><th>名称</th><th>最新价</th><th>涨幅%</th><th>涨速</th><th>主力净流入</th><th>成交额</th><th>量比</th>';
        html += '</tr></thead><tbody>';
        for (const s of (d.涨幅榜 || [])) {
            const cls = s.涨幅 >= 0 ? 'sp-up' : 'sp-down';
            const code = s.代码 || '';
            const inWatch = stockWatchlist.some(w => w.code === code);
            html += `<tr style="cursor:pointer">`;
            html += `<td style="text-align:center"><span class="star-btn" style="cursor:pointer;color:${inWatch ? 'var(--blue)' : 'var(--text2)'}" onclick="event.stopPropagation();toggleWatchlist('${code}','${escapeHtml(s.名称 || '')}')">${inWatch ? '★' : '☆'}</span></td>`;
            html += `<td class="sp-code" onclick="stockCurrentCode='${code}';switchStockView('kline')">${code}</td>`;
            html += `<td class="sp-name" onclick="stockCurrentCode='${code}';switchStockView('kline')">${escapeHtml(s.名称 || '')}</td>`;
            html += `<td class="${cls}" onclick="stockCurrentCode='${code}';switchStockView('kline')">${s.最新价 || '-'}</td>`;
            html += `<td class="${cls}" onclick="stockCurrentCode='${code}';switchStockView('kline')">${(s.涨幅 || 0).toFixed(2)}</td>`;
            html += `<td onclick="stockCurrentCode='${code}';switchStockView('kline')">${s.涨速 != null ? s.涨速.toFixed(2) : '-'}</td>`;
            const flow = s.主力净流入;
            const flowCls = flow >= 0 ? 'sp-up' : 'sp-down';
            html += `<td class="${flowCls}" onclick="stockCurrentCode='${code}';switchStockView('kline')">${flow != null ? (flow >= 0 ? '+' : '') + flow.toFixed(2) + '亿' : '-'}</td>`;
            html += `<td onclick="stockCurrentCode='${code}';switchStockView('kline')">${s.成交额 || '-'}</td>`;
            html += `<td onclick="stockCurrentCode='${code}';switchStockView('kline')">${s.量比 != null ? s.量比.toFixed(2) : '-'}</td>`;
            html += '</tr>';
        }
        html += '</tbody></table>';

        // 分页
        html += '<div class="sp-pagination">';
        if (stockPanelPage > 1) {
            html += `<button class="sp-page-btn" onclick="stockPanelPage--;loadStockPanel()">上一页</button>`;
        }
        html += `<span class="sp-page-info">第 ${stockPanelPage} 页</span>`;
        html += `<button class="sp-page-btn" onclick="stockPanelPage++;loadStockPanel()">下一页</button>`;
        html += '</div>';

        // 跌幅榜
        if (d.跌幅榜 && d.跌幅榜.length > 0) {
            html += '<table class="sp-table" style="margin-top:8px;"><thead><tr>';
            html += '<th>代码</th><th>名称</th><th>最新价</th><th>跌幅%</th><th>主力净流入</th><th>成交额</th>';
            html += '</tr></thead><tbody>';
            for (const s of d.跌幅榜) {
                const cls = s.涨幅 >= 0 ? 'sp-up' : 'sp-down';
                const code = s.代码 || '';
                html += `<tr onclick="stockCurrentCode='${code}';switchStockView('kline')" style="cursor:pointer">`;
                html += `<td class="sp-code">${code}</td>`;
                html += `<td class="sp-name">${escapeHtml(s.名称 || '')}</td>`;
                html += `<td class="${cls}">${s.最新价 || '-'}</td>`;
                html += `<td class="${cls}">${(s.涨幅 || 0).toFixed(2)}</td>`;
                const flow = s.主力净流入;
                const flowCls = flow >= 0 ? 'sp-up' : 'sp-down';
                html += `<td class="${flowCls}">${flow != null ? (flow >= 0 ? '+' : '') + flow.toFixed(2) + '亿' : '-'}</td>`;
                html += `<td>${s.成交额 || '-'}</td>`;
                html += '</tr>';
            }
            html += '</tbody></table>';
        }

        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = '<div class="sp-loading">❌ 连接失败: ' + escapeHtml(e.message) + '</div>';
    }
}

// K线图
async function loadStockKline(code) {
    const container = document.getElementById('stockViewKline');
    container.innerHTML = '<div class="sp-loading">⏳ 加载K线数据...</div>';
    try {
        const res = await fetch('/api/stock-kline?code=' + encodeURIComponent(code) + '&period=' + stockCurrentPeriod);
        const d = await res.json();
        if (!d.成功) {
            container.innerHTML = '<div class="sp-loading">❌ ' + escapeHtml(d.错误 || '加载失败') + '</div>';
            return;
        }
        const data = d.数据 || [];
        if (data.length === 0) {
            container.innerHTML = '<div class="sp-loading">无数据</div>';
            return;
        }
        let html = '<div class="stock-kline-container">';
        // 工具栏：周期切换 + 操作按钮
        html += '<div class="stock-kline-toolbar">';
        html += '<div class="stock-period-btns">';
        const periods = [['daily','日K'],['weekly','周K'],['monthly','月K']];
        for (const [p, label] of periods) {
            html += `<button class="stock-period-btn ${stockCurrentPeriod === p ? 'active' : ''}" onclick="stockCurrentPeriod='${p}';loadStockKline('${code}')">${label}</button>`;
        }
        html += '</div>';
        html += '<div class="stock-kline-actions">';
        const inWatch = stockWatchlist.some(w => w.code === code);
        html += `<button class="stock-action-btn ${inWatch ? 'active' : ''}" onclick="toggleWatchlist('${code}','${escapeHtml((d.股票信息||{}).名称||'')}')">${inWatch ? '★ 已加自选' : '☆ 加自选'}</button>`;
        html += `<button class="stock-action-btn" onclick="exportKline('${code}')">📥 导出CSV</button>`;
        html += `<button class="stock-action-btn" onclick="switchStockView('flow')">💰 资金</button>`;
        html += `<button class="stock-action-btn" onclick="switchStockView('minute')">⏱️ 分时</button>`;
        html += '</div>';
        html += '</div>';
        // 头部信息
        html += '<div class="stock-kline-header">';
        const info = d.股票信息 || {};
        const cls = (info.涨跌幅 || 0) >= 0 ? 'sp-up' : 'sp-down';
        html += `<span class="sk-name">${escapeHtml(info.名称 || code)} <span style="font-size:12px;color:var(--text2)">${code}</span></span>`;
        html += `<div class="sk-info">`;
        html += `<span class="${cls}" style="font-size:16px;font-weight:bold">${info.最新价 || '-'}</span>`;
        html += `<span class="${cls}">${(info.涨跌幅 || 0) >= 0 ? '+' : ''}${(info.涨跌幅 || 0).toFixed(2)}%</span>`;
        html += `<span style="color:#FFD700">MA5:${info.MA5 || '-'}</span>`;
        html += `<span style="color:#FF6EC7">MA10:${info.MA10 || '-'}</span>`;
        html += `<span style="color:#9B9BFF">MA20:${info.MA20 || '-'}</span>`;
        html += `</div></div>`;
        // 个股详情栏
        html += '<div class="stock-detail-bar" id="stockDetailBar">加载中...</div>';
        // Canvas
        html += `<canvas class="stock-kline-canvas" id="klineCanvas"></canvas>`;
        html += '</div>';
        container.innerHTML = html;
        // 绘制K线（含MA线）
        drawKline('klineCanvas', data, d.MA5, d.MA10, d.MA20);
        // 加载详情
        loadStockDetail(code);
    } catch (e) {
        container.innerHTML = '<div class="sp-loading">❌ ' + escapeHtml(e.message) + '</div>';
    }
}

function drawKline(canvasId, data, ma5, ma10, ma20) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth, h = canvas.offsetHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    if (data.length === 0) { ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, w, h); return; }

    // 视口：默认显示全部数据
    let viewStart = 0;
    let viewCount = data.length;
    const minViewCount = 10;
    const padLeft = 8, padRight = 50, padTop = 10, padBottom = 60;
    const chartW = w - padLeft - padRight, chartH = h - padTop - padBottom;

    function calcViewport() {
        const count = Math.min(viewCount, data.length - viewStart);
        const gap = chartW / count;
        const candleW = Math.max(2, gap * 0.7);
        // 只用可见范围内的数据计算价格区间
        const visible = data.slice(viewStart, viewStart + count);
        const maxPrice = Math.max(...visible.map(d => d.高));
        const minPrice = Math.min(...visible.map(d => d.低));
        const range = maxPrice - minPrice || 1;
        const volMax = Math.max(...visible.map(d => d.量 || 0)) || 1;
        return { count, gap, candleW, maxPrice, minPrice, range, volMax };
    }

    let vp = calcViewport();

    function redraw() {
        const { count, gap, candleW, maxPrice, range, volMax } = vp;
        ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, w, h);
        const volH = 40, volTop = h - padBottom + 10;

        // 网格
        ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1;
        for (let i = 0; i <= 4; i++) {
            const y = padTop + chartH * i / 4;
            ctx.beginPath(); ctx.moveTo(padLeft, y); ctx.lineTo(padLeft + chartW, y); ctx.stroke();
            ctx.fillStyle = '#666'; ctx.font = '10px Consolas';
            ctx.fillText((maxPrice - range * i / 4).toFixed(2), padLeft + chartW + 4, y + 3);
        }

        // MA线
        function drawMA(maArr, color) {
            if (!maArr) return;
            ctx.strokeStyle = color; ctx.lineWidth = 1;
            ctx.beginPath();
            let started = false;
            for (let i = viewStart; i < viewStart + count; i++) {
                if (maArr[i] == null) { started = false; continue; }
                const x = padLeft + (i - viewStart) * gap + gap / 2;
                const y = padTop + (maxPrice - maArr[i]) / range * chartH;
                if (!started) { ctx.moveTo(x, y); started = true; }
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
        drawMA(ma5, '#FFD700');
        drawMA(ma10, '#FF6EC7');
        drawMA(ma20, '#9B9BFF');

        // K线
        for (let i = viewStart; i < viewStart + count; i++) {
            const d = data[i];
            const x = padLeft + (i - viewStart) * gap + gap / 2;
            const openY = padTop + (maxPrice - d.开) / range * chartH;
            const closeY = padTop + (maxPrice - d.收) / range * chartH;
            const highY = padTop + (maxPrice - d.高) / range * chartH;
            const lowY = padTop + (maxPrice - d.低) / range * chartH;
            const isUp = d.收 >= d.开;
            const color = isUp ? '#f14c4c' : '#4EC9B0';
            ctx.strokeStyle = color; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x, highY); ctx.lineTo(x, lowY); ctx.stroke();
            const bodyTop = Math.min(openY, closeY);
            const bodyH = Math.max(1, Math.abs(closeY - openY));
            if (isUp) { ctx.strokeStyle = color; ctx.strokeRect(x - candleW/2, bodyTop, candleW, bodyH); }
            else { ctx.fillStyle = color; ctx.fillRect(x - candleW/2, bodyTop, candleW, bodyH); }
        }

        // 成交量
        for (let i = viewStart; i < viewStart + count; i++) {
            const d = data[i];
            const x = padLeft + (i - viewStart) * gap + gap / 2;
            const vh = (d.量 || 0) / volMax * volH;
            ctx.fillStyle = d.收 >= d.开 ? 'rgba(241,76,76,0.5)' : 'rgba(78,201,176,0.5)';
            ctx.fillRect(x - candleW/2, volTop + volH - vh, candleW, vh);
        }

        // 日期标签
        ctx.fillStyle = '#666'; ctx.font = '10px Consolas';
        const labelIdxs = [0, Math.floor(count / 2), count - 1];
        for (const offset of labelIdxs) {
            const idx = viewStart + offset;
            if (idx >= data.length) continue;
            const x = padLeft + offset * gap + gap / 2;
            ctx.fillText(data[idx].日期, x - 20, h - padBottom + 55);
        }

        // 缩放/平移提示
        ctx.fillStyle = '#444'; ctx.font = '10px Consolas';
        ctx.fillText(`显示 ${viewStart + 1}-${viewStart + count}/${data.length} (滚轮缩放·中键拖动)`, padLeft, h - 4);
    }

    redraw();

    // 鼠标滚轮缩放
    canvas.onwheel = function(e) {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 1.2 : 0.83;
        let newCount = Math.round(viewCount * factor);
        newCount = Math.max(minViewCount, Math.min(data.length, newCount));
        if (newCount === viewCount) return;
        // 以鼠标位置为中心缩放
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const ratio = (mx - padLeft) / chartW;
        let newStart = Math.round(viewStart + (viewCount - newCount) * ratio);
        newStart = Math.max(0, Math.min(data.length - newCount, newStart));
        viewStart = newStart;
        viewCount = newCount;
        vp = calcViewport();
        redraw();
    };

    // 中键拖动平移
    let panning = false, panStartX = 0, panStartViewStart = 0;
    canvas.onmousedown = function(e) {
        if (e.button === 1) {
            e.preventDefault();
            panning = true;
            panStartX = e.clientX;
            panStartViewStart = viewStart;
            canvas.style.cursor = 'grabbing';
        }
    };
    canvas.onmousemove = function(e) {
        if (panning) {
            const rect = canvas.getBoundingClientRect();
            const dx = e.clientX - panStartX;
            const dataShift = Math.round(dx / vp.gap);
            let newStart = panStartViewStart - dataShift;
            newStart = Math.max(0, Math.min(data.length - viewCount, newStart));
            if (newStart !== viewStart) {
                viewStart = newStart;
                vp = calcViewport();
                redraw();
            }
            return;
        }
        // 十字光标
        const mx = e.clientX - canvas.getBoundingClientRect().left;
        const my = e.clientY - canvas.getBoundingClientRect().top;
        if (mx < padLeft || mx > padLeft + chartW) { redraw(); return; }
        const { count, gap, candleW, maxPrice, range } = vp;
        const idx = Math.min(viewStart + count - 1, Math.max(viewStart, viewStart + Math.round((mx - padLeft - gap / 2) / gap)));
        redraw();
        const cx = padLeft + (idx - viewStart) * gap + gap / 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(cx, padTop); ctx.lineTo(cx, padTop + chartH); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(padLeft, my); ctx.lineTo(padLeft + chartW, my); ctx.stroke();
        ctx.setLineDash([]);
        const hoverPrice = maxPrice - (my - padTop) / chartH * range;
        ctx.fillStyle = '#333'; ctx.fillRect(padLeft + chartW, my - 8, padRight, 16);
        ctx.fillStyle = '#fff'; ctx.font = '10px Consolas';
        ctx.fillText(hoverPrice.toFixed(2), padLeft + chartW + 4, my + 3);
        const d = data[idx];
        if (d) {
            const tipHtml = `<div class="st-date">${d.日期}</div>`
                + `<div class="st-row"><span class="st-label">开</span><span style="color:${d.收>=d.开?'#f14c4c':'#4EC9B0'}">${d.开}</span></div>`
                + `<div class="st-row"><span class="st-label">高</span><span style="color:#f14c4c">${d.高}</span></div>`
                + `<div class="st-row"><span class="st-label">低</span><span style="color:#4EC9B0">${d.低}</span></div>`
                + `<div class="st-row"><span class="st-label">收</span><span style="color:${d.收>=d.开?'#f14c4c':'#4EC9B0'}">${d.收}</span></div>`
                + `<div class="st-row"><span class="st-label">量</span><span>${(d.量/10000).toFixed(0)}万</span></div>`;
            let tip = document.getElementById('klineTooltip');
            if (!tip) {
                tip = document.createElement('div');
                tip.id = 'klineTooltip';
                tip.className = 'stock-tooltip';
                canvas.parentElement.style.position = 'relative';
                canvas.parentElement.appendChild(tip);
            }
            tip.innerHTML = tipHtml;
            tip.style.display = 'block';
            tip.style.left = (cx + 10) + 'px';
            tip.style.top = (my + 10) + 'px';
        }
    };
    canvas.onmouseup = function(e) {
        if (e.button === 1) { panning = false; canvas.style.cursor = ''; }
    };
    canvas.onmouseleave = function() {
        panning = false;
        canvas.style.cursor = '';
        redraw();
        const tip = document.getElementById('klineTooltip');
        if (tip) tip.style.display = 'none';
    };
}

// 分时图
async function loadStockMinute(code) {
    const container = document.getElementById('stockViewMinute');
    container.innerHTML = '<div class="sp-loading">⏳ 加载分时数据...</div>';
    try {
        const res = await fetch('/api/stock-minute?code=' + encodeURIComponent(code));
        const d = await res.json();
        if (!d.成功) {
            container.innerHTML = '<div class="sp-loading">❌ ' + escapeHtml(d.错误 || '加载失败') + '</div>';
            return;
        }
        const data = d.数据 || [];
        if (data.length === 0) {
            container.innerHTML = '<div class="sp-loading">无数据</div>';
            return;
        }
        let html = '<div class="stock-minute-container">';
        html += '<div class="stock-minute-header">';
        const info = d.股票信息 || {};
        const cls = (info.涨跌幅 || 0) >= 0 ? 'sp-up' : 'sp-down';
        html += `<span class="sm-name">${escapeHtml(info.名称 || code)} <span style="font-size:12px;color:var(--text2)">${code}</span></span>`;
        html += `<span class="sm-price ${cls}">${info.最新价 || '-'} (${(info.涨跌幅 || 0) >= 0 ? '+' : ''}${(info.涨跌幅 || 0).toFixed(2)}%)</span>`;
        html += '</div>';
        html += `<canvas class="stock-minute-canvas" id="minuteCanvas"></canvas>`;
        html += '</div>';
        container.innerHTML = html;
        drawMinute('minuteCanvas', data, d.昨收价);
    } catch (e) {
        container.innerHTML = '<div class="sp-loading">❌ ' + escapeHtml(e.message) + '</div>';
    }
}

function drawMinute(canvasId, data, prevClose) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.offsetWidth, h = canvas.offsetHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.fillStyle = '#0a0a0a'; ctx.fillRect(0, 0, w, h);

    if (data.length === 0) return;
    const prices = data.map(d => d.价格);
    const maxP = Math.max(...prices, prevClose || 0);
    const minP = Math.min(...prices, prevClose || prices[0]);
    const range = Math.max(maxP - minP, prevClose * 0.01, 0.01);
    const padL = 8, padR = 50, padT = 10, padB = 30;
    const cW = w - padL - padR, cH = h - padT - padB;

    // 网格+刻度
    ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = padT + cH * i / 4;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + cW, y); ctx.stroke();
        // 涨跌幅
        const pct = (1 - i / 4) * range / (prevClose || 1) * 100;
        ctx.fillStyle = pct >= 0 ? '#f14c4c' : '#4EC9B0';
        ctx.font = '10px Consolas';
        ctx.fillText((pct >= 0 ? '+' : '') + pct.toFixed(2) + '%', padL + cW + 4, y + 3);
    }

    // 昨收线
    if (prevClose) {
        const yPrev = padT + (maxP - prevClose) / range * cH;
        ctx.strokeStyle = '#555'; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(padL, yPrev); ctx.lineTo(padL + cW, yPrev); ctx.stroke();
        ctx.setLineDash([]);
    }

    // 分时线
    ctx.strokeStyle = '#d4d4d4'; ctx.lineWidth = 1;
    ctx.beginPath();
    data.forEach((d, i) => {
        const x = padL + i / (data.length - 1) * cW;
        const y = padT + (maxP - d.价格) / range * cH;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // 均价线（如果有）
    if (data[0].均价 != null) {
        ctx.strokeStyle = '#FFD700'; ctx.lineWidth = 1;
        ctx.beginPath();
        data.forEach((d, i) => {
            const x = padL + i / (data.length - 1) * cW;
            const y = padT + (maxP - d.均价) / range * cH;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();
    }

    // 成交量柱
    const volMax = Math.max(...data.map(d => d.量 || 0)) || 1;
    const volH = 25;
    const volTop = h - padB + 5;
    data.forEach((d, i) => {
        const x = padL + i / (data.length - 1) * cW;
        const vh = (d.量 || 0) / volMax * volH;
        const isUp = d.价格 >= (prevClose || d.价格);
        ctx.fillStyle = isUp ? 'rgba(241,76,76,0.3)' : 'rgba(78,201,176,0.3)';
        ctx.fillRect(x - 1, volTop + volH - vh, 2, vh);
    });
}

// ============ 个股详情 ============
async function loadStockDetail(code) {
    const bar = document.getElementById('stockDetailBar');
    if (!bar) return;
    try {
        const res = await fetch('/api/stock-detail?code=' + encodeURIComponent(code));
        const d = await res.json();
        if (!d.成功 || !d.详情) { bar.innerHTML = '<span style="color:var(--text2)">详情获取失败</span>'; return; }
        const dt = d.详情;
        const cls = (dt.涨跌幅 || 0) >= 0 ? 'sp-up' : 'sp-down';
        let html = '';
        html += `<div class="sd-item"><span class="sd-label">PE(动)</span><span class="sd-value">${dt['市盈率(动)'] || '-'}</span></div>`;
        html += `<div class="sd-item"><span class="sd-label">PB</span><span class="sd-value">${dt['市净率'] || '-'}</span></div>`;
        html += `<div class="sd-item"><span class="sd-label">换手</span><span class="sd-value">${dt['换手率'] || '-'}%</span></div>`;
        html += `<div class="sd-item"><span class="sd-label">振幅</span><span class="sd-value">${dt['振幅'] || '-'}%</span></div>`;
        html += `<div class="sd-item"><span class="sd-label">总市值</span><span class="sd-value">${dt['总市值'] || '-'}</span></div>`;
        html += `<div class="sd-item"><span class="sd-label">流通</span><span class="sd-value">${dt['流通市值'] || '-'}</span></div>`;
        html += `<div class="sd-item"><span class="sd-label">成交额</span><span class="sd-value">${dt['成交额'] || '-'}</span></div>`;
        html += `<div class="sd-item"><span class="sd-label">52周高</span><span class="sd-value" style="color:#f14c4c">${dt['52周最高'] || '-'}</span></div>`;
        html += `<div class="sd-item"><span class="sd-label">52周低</span><span class="sd-value" style="color:#4EC9B0">${dt['52周最低'] || '-'}</span></div>`;
        bar.innerHTML = html;
    } catch (e) {
        bar.innerHTML = '<span style="color:var(--text2)">详情获取失败</span>';
    }
}

// ============ 板块行情 ============
async function loadStockSectors() {
    const container = document.getElementById('stockViewSectors');
    container.innerHTML = '<div class="sp-loading">⏳ 加载板块数据...</div>';
    try {
        const res = await fetch('/api/stock-sectors');
        const d = await res.json();
        if (!d.成功) {
            container.innerHTML = '<div class="sp-loading">❌ ' + escapeHtml(d.错误 || '加载失败') + '</div>';
            return;
        }
        const bk = d.板块 || {};
        let html = '';
        // 行业板块
        html += '<div class="sp-sector-title">🏭 行业板块</div>';
        html += '<table class="sp-sector-table"><thead><tr>';
        html += '<th>板块</th><th>涨跌幅%</th><th>涨家数</th><th>跌家数</th><th>换手率%</th><th>领涨股</th>';
        html += '</tr></thead><tbody>';
        for (const s of (bk.行业 || [])) {
            const cls = s.涨跌幅 >= 0 ? 'sp-up' : 'sp-down';
            html += '<tr>';
            html += `<td class="sp-name">${escapeHtml(s.名称 || '')}</td>`;
            html += `<td class="${cls}">${(s.涨跌幅 || 0).toFixed(2)}</td>`;
            html += `<td style="color:#f14c4c">${s.涨家数 || 0}</td>`;
            html += `<td style="color:#4EC9B0">${s.跌家数 || 0}</td>`;
            html += `<td>${(s.换手率 || 0).toFixed(2)}</td>`;
            html += `<td style="color:var(--text2)">${escapeHtml(s.领涨股 || '-')}</td>`;
            html += '</tr>';
        }
        html += '</tbody></table>';
        // 概念板块
        html += '<div class="sp-sector-title" style="margin-top:12px;">💡 概念板块</div>';
        html += '<table class="sp-sector-table"><thead><tr>';
        html += '<th>板块</th><th>涨跌幅%</th><th>涨家数</th><th>跌家数</th><th>换手率%</th><th>领涨股</th>';
        html += '</tr></thead><tbody>';
        for (const s of (bk.概念 || [])) {
            const cls = s.涨跌幅 >= 0 ? 'sp-up' : 'sp-down';
            html += '<tr>';
            html += `<td class="sp-name">${escapeHtml(s.名称 || '')}</td>`;
            html += `<td class="${cls}">${(s.涨跌幅 || 0).toFixed(2)}</td>`;
            html += `<td style="color:#f14c4c">${s.涨家数 || 0}</td>`;
            html += `<td style="color:#4EC9B0">${s.跌家数 || 0}</td>`;
            html += `<td>${(s.换手率 || 0).toFixed(2)}</td>`;
            html += `<td style="color:var(--text2)">${escapeHtml(s.领涨股 || '-')}</td>`;
            html += '</tr>';
        }
        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = '<div class="sp-loading">❌ ' + escapeHtml(e.message) + '</div>';
    }
}

// ============ 资金流向 ============
async function loadStockFlow(code) {
    const container = document.getElementById('stockViewFlow');
    container.innerHTML = '<div class="sp-loading">⏳ 加载资金流向...</div>';
    try {
        const res = await fetch('/api/stock-capital-flow?code=' + encodeURIComponent(code));
        const d = await res.json();
        if (!d.成功) {
            container.innerHTML = '<div class="sp-loading">❌ ' + escapeHtml(d.错误 || '加载失败') + '</div>';
            return;
        }
        const data = d.数据 || [];
        if (data.length === 0) {
            container.innerHTML = '<div class="sp-loading">无数据</div>';
            return;
        }
        let html = '<div style="padding:8px;">';
        html += `<div style="font-size:14px;font-weight:bold;margin-bottom:8px;">💰 ${code} 资金流向（近${data.length}日）</div>`;
        html += '<table class="sp-flow-table"><thead><tr>';
        html += '<th>日期</th><th>主力净流入</th><th>超大单</th><th>大单</th><th>中单</th><th>小单</th><th>主力占比%</th>';
        html += '</tr></thead><tbody>';
        for (const r of data) {
            const mainFlow = r.主力净流入 || 0;
            const mainCls = mainFlow >= 0 ? 'sp-up' : 'sp-down';
            const bigCls = (r.超大单净流入 || 0) >= 0 ? 'sp-up' : 'sp-down';
            const largeCls = (r.大单净流入 || 0) >= 0 ? 'sp-up' : 'sp-down';
            const midCls = (r.中单净流入 || 0) >= 0 ? 'sp-up' : 'sp-down';
            const smallCls = (r.小单净流入 || 0) >= 0 ? 'sp-up' : 'sp-down';
            html += '<tr>';
            html += `<td>${r.日期 || ''}</td>`;
            html += `<td class="${mainCls}">${mainFlow >= 0 ? '+' : ''}${mainFlow.toFixed(2)}万</td>`;
            html += `<td class="${bigCls}">${(r.超大单净流入 || 0) >= 0 ? '+' : ''}${(r.超大单净流入 || 0).toFixed(2)}万</td>`;
            html += `<td class="${largeCls}">${(r.大单净流入 || 0) >= 0 ? '+' : ''}${(r.大单净流入 || 0).toFixed(2)}万</td>`;
            html += `<td class="${midCls}">${(r.中单净流入 || 0) >= 0 ? '+' : ''}${(r.中单净流入 || 0).toFixed(2)}万</td>`;
            html += `<td class="${smallCls}">${(r.小单净流入 || 0) >= 0 ? '+' : ''}${(r.小单净流入 || 0).toFixed(2)}万</td>`;
            html += `<td class="${mainCls}">${(r.主力净流入占比 || 0).toFixed(2)}</td>`;
            html += '</tr>';
        }
        html += '</tbody></table>';
        html += '</div>';
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = '<div class="sp-loading">❌ ' + escapeHtml(e.message) + '</div>';
    }
}

// ============ 自选股管理 ============
function toggleWatchlist(code, name) {
    const idx = stockWatchlist.findIndex(w => w.code === code);
    if (idx >= 0) {
        stockWatchlist.splice(idx, 1);
    } else {
        stockWatchlist.push({ code, name });
    }
    localStorage.setItem('stockWatchlist', JSON.stringify(stockWatchlist));
    renderWatchlist();
    // 如果在K线视图，刷新按钮状态
    if (stockCurrentView === 'kline' && stockCurrentCode === code) {
        loadStockKline(code);
    }
    // 如果在盘面视图，刷新列表
    if (stockCurrentView === 'panel') {
        loadStockPanel();
    }
}

function renderWatchlist() {
    const container = document.getElementById('stockSidebarList');
    if (!container) return;
    if (stockWatchlist.length === 0) {
        container.innerHTML = '<div class="ss-header">自选股</div><div style="font-size:10px;color:var(--text2);padding:4px 6px;">暂无自选<br>点击 ☆ 添加</div>';
        return;
    }
    let html = '<div class="ss-header">自选股 (' + stockWatchlist.length + ')</div>';
    for (const w of stockWatchlist) {
        html += `<div class="ss-watch-item" onclick="stockCurrentCode='${w.code}';switchStockView('kline')">`;
        html += `<span class="ssw-code">${w.code}</span>`;
        html += `<span class="ssw-name">${escapeHtml(w.name || '')}</span>`;
        html += `<span class="ssw-pct" id="watchPct_${w.code}">--</span>`;
        html += `<span class="ssw-del" onclick="event.stopPropagation();toggleWatchlist('${w.code}','${escapeHtml(w.name || '')}')">✕</span>`;
        html += '</div>';
    }
    container.innerHTML = html;
    // 异步加载价格
    loadWatchlistPrices();
}

async function loadWatchlistPrices() {
    if (stockWatchlist.length === 0) return;
    // 批量查询：一次API请求获取所有自选股行情
    try {
        const codes = stockWatchlist.map(w => w.code).join(',');
        const res = await fetch('/api/stock-batch?codes=' + encodeURIComponent(codes));
        const d = await res.json();
        if (d.成功 && d.数据) {
            for (const s of d.数据) {
                const el = document.getElementById('watchPct_' + s.代码);
                if (el) {
                    const pct = s.涨跌幅 || 0;
                    el.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
                    el.className = 'ssw-pct ' + (pct >= 0 ? 'sp-up' : 'sp-down');
                }
            }
        }
    } catch (e) {}
}

// ============ 导出K线CSV ============
function exportKline(code) {
    const period = stockCurrentPeriod || 'daily';
    window.open('/api/stock-export?code=' + encodeURIComponent(code) + '&period=' + period, '_blank');
}

// ============ 股票缓存管理 ============
async function showStockCacheStats() {
    try {
        const res = await fetch('/api/stock-cache-stats');
        const d = await res.json();
        if (d.成功 && d.统计) {
            return d.统计;
        }
    } catch (e) {}
    return null;
}

async function clearStockCache() {
    try {
        await fetch('/api/stock-cache-clear');
        if (stockCurrentView === 'panel') loadStockPanel();
        else if (stockCurrentView === 'kline' && stockCurrentCode) loadStockKline(stockCurrentCode);
    } catch (e) {}
}

