// ========== app-minimap-worker-bootstrap.js - 小地图 Worker 引导 ==========
// 必须在 app-minimap.js 之前加载。
// 职责：fetch minimap-worker.js 源码 → Blob URL → 挂到全局 MinimapWorker.blobUrl，
//      供 app-minimap.js 的 setupMinimap() 创建 Worker + OffscreenCanvas。
// 若 fetch 失败，MinimapWorker.blobUrl 保持 null，主线程走 _drawMinimapFallback 降级。
(function () {
    'use strict';
    var g = typeof window !== 'undefined' ? window : globalThis;
    g.MinimapWorker = {
        blobUrl: null,
        ready: false,
        _cbs: [],
        onReady: function (cb) { this.ready ? cb() : this._cbs.push(cb); }
    };
    try {
        fetch('js/minimap-worker.js?v=1', { cache: 'force-cache' })
            .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
            .then(function (src) {
                g.MinimapWorker.blobUrl = URL.createObjectURL(
                    new Blob([src], { type: 'application/javascript' })
                );
                g.MinimapWorker.ready = true;
                g.MinimapWorker._cbs.forEach(function (cb) { try { cb(); } catch (e) {} });
                g.MinimapWorker._cbs.length = 0;
            })
            .catch(function () { /* blobUrl 保持 null，主线程降级 */ });
    } catch (e) { /* 同上 */ }
})();
