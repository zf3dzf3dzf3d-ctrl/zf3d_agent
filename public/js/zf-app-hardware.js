/* i硬件 内容模块（策划案 v2.2 M-H1）
 * 挂载点：#zfHardwareBody（由 zf-app-dock.js createAppWindow 创建的 Dock 窗口）
 * 依赖：window.ZFHardware.onOpen(body) 由 dock 在 openHardware 时调用
 * 数据：/api/hw/info（静态+本地白话解读）、/api/hw/live（实时，5s 轮询）
 * 红线：温度恒占位提示（Windows 无标准接口）；"问AI"先拉 sanitize-preview 弹卡确认
 */
(function () {
  'use strict';
  if (window.ZFHardware && window.ZFHardware._ready) return;

  var state = { body: null, liveTimer: null, info: null };

  function api(path) {
    return fetch(path, { credentials: 'same-origin' }).then(function (r) { return r.json(); });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------- 渲染 ---------- */
  function renderInfo(info) {
    var c = info.cpu || {}, m = info.memory || {}, lr = info.localRead || {};
    var parts = (info.partitions || []).map(function (p) {
      return '<div class="hw-row"><span>' + esc(p.mount) + '</span>' +
        '<div class="hw-bar"><i style="width:' + (p.pct || 0) + '%"></i></div>' +
        '<span class="hw-dim">' + p.usedGB + '/' + p.totalGB + 'GB</span></div>';
    }).join('');
    var gpus = (info.gpu || []).map(function (g) {
      return '<div class="hw-row"><span>' + esc(g.name) + '</span><span class="hw-dim">驱动 ' + esc(g.driverVersion) + '</span></div>';
    }).join('') || '<div class="hw-dim">未检测到</div>';
    var t = info.temperature || {};
    return '<div class="hw-grade">' + esc(lr.grade || '') + '</div>' +
      '<div class="hw-note">' + esc(lr.note || '') + '</div>' +
      '<div class="hw-card"><b>CPU</b><div class="hw-row"><span>' + esc(c.name) + '</span></div>' +
      '<div class="hw-dim">' + (c.coresPhysical || '?') + '核' + (c.coresLogical || '?') + '线程 · ' + esc(c.arch) + '</div></div>' +
      '<div class="hw-card"><b>内存</b><div class="hw-dim">总容量 ' + (m.totalGB || '?') + 'GB</div></div>' +
      '<div class="hw-card"><b>磁盘</b>' + parts + '</div>' +
      '<div class="hw-card"><b>显卡</b>' + gpus + '</div>' +
      '<div class="hw-card"><b>温度</b><div class="hw-dim">' + esc(t.available ? '' : (t.note || '温度不可用（占位提示）')) + '</div></div>';
  }

  function renderLive(d) {
    var el = state.body && state.body.querySelector('#hwLive');
    if (!el) return;
    var disks = (d.disks || []).map(function (p) {
      return '<div class="hw-row"><span>' + esc(p.mount) + '</span>' +
        '<div class="hw-bar"><i style="width:' + (p.pct || 0) + '%"></i></div>' +
        '<span class="hw-dim">' + p.freeGB + 'GB 可用</span></div>';
    }).join('');
    el.innerHTML =
      '<div class="hw-live-row"><span>CPU</span><b>' + (d.cpuPct || 0) + '%</b></div>' +
      '<div class="hw-live-row"><span>内存</span><b>' + (d.memPct || 0) + '%</b> <span class="hw-dim">(' + d.memUsedGB + '/' + d.memTotalGB + 'GB)</span></div>' +
      disks +
      '<div class="hw-live-row"><span>进程数</span><b>' + (d.processes || 0) + '</b></div>' +
      '<div class="hw-dim">' + (d.temperature && d.temperature.available ? '' : '🌡 温度不可用（本机无标准温度接口）') + '</div>';
  }

  /* ---------- extra：每核CPU + GPU + WiFi（/api/hw/extra，5s 同步轮询） ---------- */
  function renderExtra(el, x) {
    if (!x || !x.ok) return;
    var cpu = x.cpu || {}, gpu = x.gpu || {}, wifi = x.wifi || {};
    var perCore = (cpu.perCorePct || []).map(function (p, i) {
      return '<span class="hw-core" title="核心' + (i + 1) + '">C' + (i + 1) + ' ' + p + '%</span>';
    }).join(' ');
    var freq = cpu.freqMHz ? (cpu.freqMHz + 'MHz' + (cpu.maxMHz ? ' / 峰值' + cpu.maxMHz + 'MHz' : '')) : '—';
    var gpuLine = gpu.available
      ? esc(gpu.name || '') + ' · 利用率 ' + (gpu.utilPct != null ? gpu.utilPct + '%' : '无接口') +
        ' · 显存 ' + (gpu.memUsedMB != null ? gpu.memUsedMB + '/' + (gpu.memTotalMB || '?') + 'MB' : '—') +
        '<div class="hw-dim">驱动 ' + esc(gpu.driverVersion || '?') + (gpu.note ? ' · ' + esc(gpu.note) : '') + '</div>'
      : '<span class="hw-dim">未检测到显卡</span>';
    var wifiLine = wifi.available
      ? (wifi.ssid ? esc(wifi.ssid) : '未连接') +
        ' · ' + esc(wifi.state || '') +
        (wifi.signalPct != null ? ' · 信号 ' + wifi.signalPct + '%' : '') +
        (wifi.radio ? ' · ' + esc(wifi.radio) : '') +
        (wifi.note ? '<div class="hw-dim">' + esc(wifi.note) + '</div>' : '')
      : '<span class="hw-dim">未获取到 WLAN 信息（无无线网卡或服务未启动）</span>';
    el.innerHTML =
      '<div class="hw-live-row"><span>CPU 频率</span><b>' + esc(freq) + '</b></div>' +
      '<div class="hw-live-row"><span>每核占用</span><span>' + perCore + '</span></div>' +
      '<div class="hw-live-row"><span>GPU</span><span>' + gpuLine + '</span></div>' +
      '<div class="hw-live-row"><span>WiFi</span><span>' + wifiLine + '</span></div>';
  }

  /* ---------- 驱动更新：询问硬件 → 版本检测 → 官方下载引导（策划案 v1） ---------- */
  var HW_DRIVER_TYPES = [
    { t: 'gpu', label: '🎮 显卡' },
    { t: 'audio', label: '🔊 声卡' },
    { t: 'net_wired', label: '🌐 网卡（有线）' },
    { t: 'net_wifi', label: '📶 网卡（无线）' },
    { t: 'board', label: '🔧 主板 / BIOS' }
  ];
  function openDriverDialog() {
    var dlg = document.getElementById('hwDriverDlg');
    if (dlg) dlg.remove();
    dlg = document.createElement('div');
    dlg.id = 'hwDriverDlg';
    dlg.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:99999';
    dlg.innerHTML =
      '<div style="background:#fff;border-radius:12px;max-width:440px;width:92%;padding:20px;font-size:14px;color:#333">' +
      '<b style="font-size:16px">驱动更新</b>' +
      '<div style="margin:10px 0;color:#666">您想更新哪个硬件的驱动？（本工具不直接下载安装，仅检测版本并引导官方下载）</div>' +
      '<div id="hwDrvList"></div>' +
      '<button id="hwDrvWU" style="display:block;width:100%;margin:10px 0 0;padding:10px;border:0;border-radius:8px;background:#e5e7eb;color:#333;cursor:pointer">兜底：打开 Windows 更新 / 设备管理器</button>' +
      '<button id="hwDrvClose" style="display:block;width:100%;margin:6px 0 0;padding:8px;border:0;border-radius:8px;background:transparent;color:#888;cursor:pointer">关闭</button>' +
      '</div>';
    document.body.appendChild(dlg);
    var list = dlg.querySelector('#hwDrvList');
    list.innerHTML = HW_DRIVER_TYPES.map(function (it) {
      return '<button data-t="' + it.t + '" style="display:block;width:100%;margin:6px 0;padding:10px;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer;text-align:left">' + it.label + '</button>';
    }).join('');
    Array.prototype.forEach.call(list.querySelectorAll('button[data-t]'), function (btn) {
      btn.onclick = function () { showDriverDetail(dlg, btn.getAttribute('data-t'), btn.textContent.trim()); };
    });
    dlg.querySelector('#hwDrvWU').onclick = function () { driverOpenPick(dlg); };
    dlg.querySelector('#hwDrvClose').onclick = function () { dlg.remove(); };
    dlg.onclick = function (e) { if (e.target === dlg) dlg.remove(); };
  }
  function driverOpenPick(dlg) {
    dlg.remove();
    var pick = document.getElementById('hwDrvPickDlg');
    if (pick) pick.remove();
    pick = document.createElement('div');
    pick.id = 'hwDrvPickDlg';
    pick.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:99999';
    pick.innerHTML =
      '<div style="background:#fff;border-radius:12px;max-width:380px;width:88%;padding:18px;font-size:14px;color:#333">' +
      '<b>打开哪个系统工具？</b>' +
      '<button id="hwDrvP1" style="display:block;width:100%;margin:10px 0 0;padding:10px;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer">Windows 更新（推荐，系统自动装驱动）</button>' +
      '<button id="hwDrvP2" style="display:block;width:100%;margin:6px 0 0;padding:10px;border:0;border-radius:8px;background:#e5e7eb;color:#333;cursor:pointer">设备管理器（手动更新指定设备）</button>' +
      '<button id="hwDrvP0" style="display:block;width:100%;margin:6px 0 0;padding:8px;border:0;border-radius:8px;background:transparent;color:#888;cursor:pointer">返回</button>' +
      '</div>';
    document.body.appendChild(pick);
    pick.querySelector('#hwDrvP1').onclick = function () { pick.remove(); driverOpen('windowsupdate'); };
    pick.querySelector('#hwDrvP2').onclick = function () { pick.remove(); driverOpen('devmgr'); };
    pick.querySelector('#hwDrvP0').onclick = function () { pick.remove(); openDriverDialog(); };
  }
  function showDriverDetail(dlg, typ, label) {
    var area = dlg.querySelector('#hwDrvList');
    area.innerHTML = '<div class="hw-dim" style="color:#888;padding:12px 0">正在检测「' + esc(label) + '」当前驱动…</div>';
    fetch('/api/hw/driver-check?type=' + encodeURIComponent(typ), { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (!d) { area.innerHTML = '<div style="color:#c00;padding:10px 0">检测失败</div>'; return; }
        var html = '<div style="background:#f5f6f8;border-radius:8px;padding:12px;margin:8px 0">' +
          '<b style="font-size:13px">' + esc(label) + '</b><br>' +
          (d.ok ? '<div style="margin-top:6px;color:#555">型号：' + esc(d.name || '未知') + '</div>' +
            (d.version ? '<div style="color:#555">当前版本：' + esc(d.version) + '</div>' : '') +
            (d.note ? '<div style="color:#888;font-size:12px;margin-top:4px">' + esc(d.note) + '</div>' : '')
            : '<div style="color:#888;margin-top:6px">未检测到该硬件信息</div>') +
          '</div>';
        if (d.officialUrl && /^https?:/.test(d.officialUrl)) {
          html += '<button id="hwDrvSite" style="display:block;width:100%;margin:6px 0 0;padding:10px;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer">🔗 打开 ' + esc(d.vendor) + ' 官方下载页（下载安装请自行确认）</button>';
        }
        html += '<button id="hwDrvBack" style="display:block;width:100%;margin:6px 0 0;padding:8px;border:0;border-radius:8px;background:transparent;color:#888;cursor:pointer">← 重新选择硬件</button>';
        area.innerHTML = html;
        var site = area.querySelector('#hwDrvSite');
        if (site) site.onclick = function () { window.open(d.officialUrl, '_blank'); };
        area.querySelector('#hwDrvBack').onclick = function () { openDriverDialog(); };
      })
      .catch(function () {
        area.innerHTML = '<div style="color:#c00;padding:10px 0">检测失败（网络/服务异常）</div>';
      });
  }
  function driverOpen(target) {
    fetch('/api/hw/driver-open', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: target })
    }).then(function (r) { return r.json(); })
      .then(function (r) {
        if (!r || !r.ok) alert('打开失败：' + ((r && r.err) || '未知错误'));
        var dlg = document.getElementById('hwDriverDlg'); if (dlg) dlg.remove();
      });
  }

  /* ---------- 生命周期 ---------- */
  function startLive() {
    stopLive();
    var tick = function () { api('/api/hw/live').then(function (d) { if (d && d.ok) renderLive(d); }); };
    var tickX = function () {
      var el = state.body && state.body.querySelector('#hwExtra');
      if (el) api('/api/hw/extra').then(function (x) { renderExtra(el, x); });
    };
    tick(); tickX();
    state.liveTimer = setInterval(function () { tick(); tickX(); }, 5000);
  }
  function stopLive() {
    if (state.liveTimer) { clearInterval(state.liveTimer); state.liveTimer = null; }
  }

  function onOpen(body) {
    state.body = body;
    body.innerHTML = '<div class="hw-wrap">' +
      '<div id="hwInfo" class="hw-info"><div class="hw-dim">读取硬件配置中…</div></div>' +
      '<div class="hw-card"><b>实时状态（5秒刷新）</b><div id="hwLive"><div class="hw-dim">加载中…</div></div></div>' +
      '<div class="hw-card"><b>性能详情（每核 / GPU / WiFi）</b><div id="hwExtra"><div class="hw-dim">加载中…</div></div></div>' +
      '<button id="hwDrvBtn" style="width:100%;margin-top:8px;padding:10px;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer;font-size:14px">🔧 驱动更新</button>' +
      '</div>';
    body.querySelector('#hwDrvBtn').onclick = openDriverDialog;
    api('/api/hw/info').then(function (r) {
      if (r && r.ok) { state.info = r.info; body.querySelector('#hwInfo').innerHTML = renderInfo(r.info); }
      else body.querySelector('#hwInfo').innerHTML = '<div class="hw-dim">读取失败：' + esc(r && r.err) + '</div>';
    });
    startLive();
  }
  function onClose() { stopLive(); }

  window.ZFHardware = { onOpen: onOpen, onClose: onClose, _ready: true };
})();
