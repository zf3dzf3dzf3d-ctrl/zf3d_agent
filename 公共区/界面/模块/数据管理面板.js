/**
 * 数据管理面板 — 股票数据管理+批量下载
 * 从 逻辑.js 拆分
 */

// ============ 数据管理面板 ============
let bulkDownloadTimer = null;

async function loadStockDataPanel() {
    const container = document.getElementById('stockViewData');
    let html = '<div class="sp-data-panel">';

    // 全量下载区
    html += '<div class="sp-data-section">';
    html += '<div class="sp-data-title">💾 全量K线数据下载</div>';
    html += '<div class="sp-data-row">';
    html += '<button class="sp-data-btn" id="bulkStartBtn" onclick="startBulkDownload(true)">📥 增量下载</button>';
    html += '<button class="sp-data-btn danger" id="bulkStopBtn" onclick="stopBulkDownload()" style="display:none;">⏹️ 停止</button>';
    html += '</div>';
    html += '<div class="sp-bulk-progress" id="bulkProgressArea" style="display:none;">';
    html += '<div class="sp-bulk-bar-container"><div class="sp-bulk-bar-fill" id="bulkBarFill" style="width:0%"></div></div>';
    html += '<div class="sp-bulk-info">';
    html += '<span id="bulkPctText">0%</span>';
    html += '<span id="bulkDetailText"></span>';
    html += '</div>';
    html += '<div style="margin-top:4px;font-size:11px;color:var(--text2);" id="bulkStatusText"></div>';
    html += '</div>';
    html += '<div style="margin-top:6px;font-size:11px;color:var(--text2);">增量下载只拉取本地没有的股票K线+财务数据(ROE/股东人数/EPS/营收/净利润/PE/PB/市值)。首次下载约5000只，之后只补新增股票。</div>';
    html += '</div>';

    // 本地K线统计
    html += '<div class="sp-data-section">';
    html += '<div class="sp-data-title">📈 本地K线数据</div>';
    html += '<div class="sp-data-stat" id="localDataStats">加载中...</div>';
    html += '</div>';

    // 本地财务数据统计
    html += '<div class="sp-data-section">';
    html += '<div class="sp-data-title">💼 本地财务数据</div>';
    html += '<div class="sp-data-stat" id="financeDataStats">加载中...</div>';
    html += '</div>';

    // 缓存管理
    html += '<div class="sp-data-section">';
    html += '<div class="sp-data-title">📦 实时缓存管理</div>';
    html += '<div class="sp-data-stat" id="cacheStatsDisplay">加载中...</div>';
    html += '<div class="sp-data-row" style="margin-top:8px;">';
    html += '<button class="sp-data-btn secondary" onclick="clearStockCache();loadStockDataPanel();">🗑️ 清空实时缓存</button>';
    html += '</div>';
    html += '</div>';

    html += '</div>';
    container.innerHTML = html;

    // 加载统计
    refreshDataStats();
    // 检查是否有正在进行的下载
    checkBulkProgress();
}

async function refreshDataStats() {
    try {
        const res = await fetch('/api/stock-bulk-progress');
        const d = await res.json();
        if (d.成功) {
            const s = d.本地统计 || {};
            const el = document.getElementById('localDataStats');
            if (el) {
                let html = '';
                html += '<div class="ds-item"><span class="ds-label">已下载:</span><span class="ds-value">' + (s.已下载股票数 || 0) + '/' + (s.A股总数 || '?') + '</span></div>';
                html += '<div class="ds-item"><span class="ds-label">K线总条数:</span><span class="ds-value">' + (s.总K线条数 || 0) + '</span></div>';
                html += '<div class="ds-item"><span class="ds-label">日期范围:</span><span class="ds-value">' + (s.最早日期 || '-') + ' ~ ' + (s.最新日期 || '-') + '</span></div>';
                el.innerHTML = html;
            }
            // 财务数据统计
            const fs = d.财务统计 || {};
            const finEl = document.getElementById('financeDataStats');
            if (finEl) {
                let fhtml = '';
                fhtml += '<div class="ds-item"><span class="ds-label">已下载:</span><span class="ds-value">' + (fs.已下载财务数据 || 0) + '</span></div>';
                fhtml += '<div class="ds-item"><span class="ds-label">有ROE:</span><span class="ds-value">' + (fs.有ROE || 0) + '</span></div>';
                fhtml += '<div class="ds-item"><span class="ds-label">有股东人数:</span><span class="ds-value">' + (fs.有股东人数 || 0) + '</span></div>';
                finEl.innerHTML = fhtml;
            }
            const cs = d.进度 || {};
            const cacheEl = document.getElementById('cacheStatsDisplay');
            if (cacheEl) {
                // 如果有下载进度，显示进度；否则显示缓存统计
                if (cs.状态 && cs.状态 !== '空闲') {
                    // 进度由 checkBulkProgress 处理
                } else {
                    try {
                        const res2 = await fetch('/api/stock-cache-stats');
                        const d2 = await res2.json();
                        if (d2.成功 && d2.统计) {
                            const st = d2.统计;
                            let html = '';
                            html += '<div class="ds-item"><span class="ds-label">总缓存:</span><span class="ds-value">' + (st.总缓存数 || 0) + '</span></div>';
                            html += '<div class="ds-item"><span class="ds-label">有效:</span><span class="ds-value">' + (st.有效缓存 || 0) + '</span></div>';
                            html += '<div class="ds-item"><span class="ds-label">已过期:</span><span class="ds-value">' + (st.已过期 || 0) + '</span></div>';
                            html += '<div class="ds-item"><span class="ds-label">' + (st.是否交易日 ? '交易日' : '非交易日') + '</span></div>';
                            html += '<div class="ds-item"><span class="ds-label">' + (st.是否盘中 ? '🔴盘中' : '⚪盘后') + '</span></div>';
                            cacheEl.innerHTML = html;
                        }
                    } catch (e) {}
                }
            }
        }
    } catch (e) {}
}

async function startBulkDownload(incremental) {
    const btn = document.getElementById('bulkStartBtn');
    const stopBtn = document.getElementById('bulkStopBtn');
    const area = document.getElementById('bulkProgressArea');
    const statusText = document.getElementById('bulkStatusText');
    // 按钮变转圈+禁用
    btn.disabled = true;
    btn.innerHTML = '⏳ 下载中...';
    btn.style.cursor = 'wait';
    stopBtn.style.display = '';
    area.style.display = '';
    statusText.textContent = '正在启动...';
    const url = '/api/stock-bulk-start?period=daily&incremental=' + (incremental ? '1' : '0') + '&finance=1';
    console.log('[股票下载] 启动请求:', url);
    try {
        const res = await fetch(url);
        console.log('[股票下载] 响应状态:', res.status, res.statusText);
        const d = await res.json();
        console.log('[股票下载] 响应数据:', JSON.stringify(d));
        if (!d.成功) {
            console.error('[股票下载] 启动失败:', d.错误);
            // 如果是"正在运行中"，不覆盖已有进度，先查一次进度
            if (d.错误 && d.错误.includes('正在运行')) {
                checkBulkProgress();
                if (bulkDownloadTimer) clearInterval(bulkDownloadTimer);
                bulkDownloadTimer = setInterval(checkBulkProgress, 1000);
                btn.disabled = true; btn.innerHTML = '⏳ 下载中...'; stopBtn.style.display = '';
                return;
            }
            statusText.textContent = '❌ ' + (d.错误 || '启动失败');
            btn.disabled = false; btn.innerHTML = '📥 增量下载'; btn.style.cursor = ''; stopBtn.style.display = 'none';
            return;
        }
        console.log('[股票下载] 启动成功，开始轮询进度');
        // 开始轮询进度
        if (bulkDownloadTimer) clearInterval(bulkDownloadTimer);
        checkBulkProgress();
        bulkDownloadTimer = setInterval(checkBulkProgress, 1000);
    } catch (e) {
        console.error('[股票下载] 启动异常:', e.message, e.stack);
        statusText.textContent = '❌ ' + e.message;
        btn.disabled = false; btn.innerHTML = '📥 增量下载'; btn.style.cursor = ''; stopBtn.style.display = 'none';
    }
}

async function stopBulkDownload() {
    try {
        await fetch('/api/stock-bulk-stop');
        document.getElementById('bulkStatusText').textContent = '正在停止...';
    } catch (e) {}
}

async function checkBulkProgress() {
    try {
        const res = await fetch('/api/stock-bulk-progress');
        const d = await res.json();
        if (!d.成功) { console.error('[股票下载] 进度查询失败:', d); return; }
        const p = d.进度 || {};
        const status = p.状态 || '空闲';
        const total = p.总数 || 0;
        const done = p.已完成 || 0;
        const failed = p.失败 || 0;
        const skipped = p.跳过 || 0;
        const processed = done + failed + skipped;
        const pct = total > 0 ? Math.round(processed / total * 100) : 0;
        // 每10次轮询打印一次进度日志
        if (!checkBulkProgress._cnt) checkBulkProgress._cnt = 0;
        checkBulkProgress._cnt++;
        if (checkBulkProgress._cnt % 10 === 1) {
            console.log(`[股票下载] 进度: ${status} | ${done}/${total} 完成, ${failed}失败, ${skipped}跳过 | 阶段:${p.阶段||'-'} 代码:${p.当前代码||'-'}`);
        }

        const barFill = document.getElementById('bulkBarFill');
        const pctText = document.getElementById('bulkPctText');
        const detailText = document.getElementById('bulkDetailText');
        const statusText = document.getElementById('bulkStatusText');
        if (barFill) barFill.style.width = pct + '%';
        if (pctText) pctText.textContent = pct + '%';
        if (detailText) {
            let detail = `完成 ${done}`;
            if (skipped > 0) detail += ` / 跳过 ${skipped}`;
            if (failed > 0) detail += ` / 失败 ${failed}`;
            detail += ` / 共 ${total}`;
            if (p.耗时秒) {
                detail += ` · ${p.耗时秒}s`;
                if (done > 0 && p.耗时秒 > 0) {
                    detail += ` · ${(done / p.耗时秒).toFixed(1)}只/秒`;
                }
            }
            if (p.预计剩余秒 && p.预计剩余秒 > 0) detail += ` · 剩余~${p.预计剩余秒}s`;
            detailText.textContent = detail;
        }
        if (statusText) {
            const stage = p.阶段 ? `[${p.阶段}] ` : '';
            const source = p.数据源 ? ` (${p.数据源})` : '';
            statusText.textContent = stage + status + source + (p.当前代码 ? ` → ${p.当前代码}` : '');
        }

        // 显示失败详情（最多5条）
        const failDetails = p.失败详情 || [];
        if (failDetails.length > 0) {
            let failHtml = '<div style="margin-top:4px;font-size:10px;color:#f14c4c;">失败: ' + failDetails.slice(0, 5).map(f => f.代码 + '(' + (f.原因||'') + ')').join(', ') + (failDetails.length > 5 ? ` ...共${failDetails.length}条` : '') + '</div>';
            let failEl = document.getElementById('bulkFailDetails');
            if (!failEl) {
                failEl = document.createElement('div');
                failEl.id = 'bulkFailDetails';
                statusText.parentElement.appendChild(failEl);
            }
            failEl.innerHTML = failHtml;
        }

        if (status.startsWith('完成') || status.startsWith('已停止') || status.startsWith('错误') || status.startsWith('失败')) {
            if (bulkDownloadTimer) { clearInterval(bulkDownloadTimer); bulkDownloadTimer = null; }
            const btn = document.getElementById('bulkStartBtn');
            const stopBtn = document.getElementById('bulkStopBtn');
            if (btn) { btn.disabled = false; btn.innerHTML = '📥 增量下载'; btn.style.cursor = ''; }
            if (stopBtn) stopBtn.style.display = 'none';
            // 完成时把完整状态文字保留显示
            if (statusText && status) statusText.textContent = status;
            refreshDataStats();
        }
    } catch (e) {}
}
