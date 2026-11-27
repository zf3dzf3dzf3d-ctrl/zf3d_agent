/* ============================================================
 * wb-3d-viewer.js - 工作台 3D 查看器子模块（S4 拆分 2026-11-30）
 * 从 app-workbench-drawer.js 207-385 行原样抽出（three.js GLTF 纯查看器）。
 * 对外接口：window.__WB3D.bindModel3D(drawer) —— 供主文件抽屉初始化时调用。
 * window.WB3DViewer 对外 API（AI 生成完成后调用 load/loadData/clear）保持不变。
 * ============================================================ */
(function () {
    'use strict';
    var drawer = null; // 由 bindModel3D(drawer) 注入的抽屉根节点（原主文件闭包变量）
    var api = { bindModel3D: null };
    window.__WB3D = api;
    // ---------- 3D 查看器（纯查看：three.js GLTFLoader，生成在对话中完成） ----------
    var wb3d = { viewer: null, renderer: null, scene: null, camera: null, model: null, grid: null, gridOn: true, wire: false, animId: null };

    function _loadScriptOnce(src, cb) {
        if (window.__wb3dLoadedScripts && window.__wb3dLoadedScripts[src]) { cb(); return; }
        window.__wb3dLoadedScripts = window.__wb3dLoadedScripts || {};
        var s = document.createElement('script'); s.src = src; s.onload = function () { window.__wb3dLoadedScripts[src] = true; cb(); };
        s.onerror = function () { cb(new Error('脚本加载ʧ败: ' + src)); };
        document.head.appendChild(s);
    }

    function ensureViewer(cb) {
        var wrap = drawer.querySelector('.wb-3d-viewer-wrap');
        var canvas = drawer.querySelector('.wb-3d-viewer-canvas');
        if (!wrap || !canvas) { cb && cb(new Error('查看器容器不存在')); return; }
        var done = function (err) {
            if (err) { cb && cb(err); return; }
            if (wb3d.viewer) { cb && cb(null, true); return; }
            try {
                var W = wrap.clientWidth || 400, H = wrap.clientHeight || 300;
                var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
                renderer.setSize(W, H, false);
                renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
                var scene = new THREE.Scene();
                var camera = new THREE.PerspectiveCamera(45, W / H, 0.01, 5000);
                camera.position.set(3, 2.2, 4);
                scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.1));
                var dir = new THREE.DirectionalLight(0xffffff, 1.2); dir.position.set(5, 10, 7); scene.add(dir);
                var grid = new THREE.GridHelper(10, 20, 0x3a5a8a, 0x22344f); grid.visible = true; scene.add(grid);
                wb3d.renderer = renderer; wb3d.scene = scene; wb3d.camera = camera; wb3d.grid = grid;
                bindViewerOrbit(canvas);
                animateViewer();
                wb3d.viewer = true;
                cb && cb(null, true);
            } catch (e) { cb && cb(e); }
        };
        if (window.THREE) {
            if (typeof THREE.GLTFLoader === 'function') { done(null); return; }
            _loadScriptOnce('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js', done);
        } else {
            _loadScriptOnce('https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js', function (e1) {
                if (e1) { cb && cb(e1); return; }
                _loadScriptOnce('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js', done);
            });
        }
    }

    function bindViewerOrbit(canvas) {
        var st = { down: false, btn: 0, x: 0, y: 0, theta: 0.6, phi: 1.1, dist: 6, target: new THREE.Vector3(0, 0.8, 0) };
        function apply() {
            var sp = { x: st.target.x + st.dist * Math.sin(st.phi) * Math.sin(st.theta), y: st.target.y + st.dist * Math.cos(st.phi), z: st.target.z + st.dist * Math.sin(st.phi) * Math.cos(st.theta) };
            wb3d.camera.position.set(sp.x, sp.y, sp.z); wb3d.camera.lookAt(st.target);
        }
        wb3d._orbitApply = apply; wb3d._orbitState = st; apply();
        canvas.addEventListener('mousedown', function (e) { st.down = true; st.btn = e.button; st.x = e.clientX; st.y = e.clientY; });
        window.addEventListener('mouseup', function () { st.down = false; });
        window.addEventListener('mousemove', function (e) {
            if (!st.down) return;
            var dx = e.clientX - st.x, dy = e.clientY - st.y; st.x = e.clientX; st.y = e.clientY;
            if (st.btn === 0) { st.theta -= dx * 0.008; st.phi = Math.max(0.05, Math.min(Math.PI - 0.05, st.phi - dy * 0.008)); }
            else {
                var right = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), fwd = new THREE.Vector3();
                fwd.subVectors(st.target, wb3d.camera.position); fwd.y = 0; fwd.normalize();
                right.crossVectors(fwd, up).negate();
                var k = st.dist * 0.0016;
                st.target.addScaledVector(right, dx * k); st.target.y = Math.max(0, st.target.y + dy * k);
            }
            apply();
        });
        canvas.addEventListener('wheel', function (e) { e.preventDefault(); st.dist = Math.max(0.05, Math.min(500, st.dist * (e.deltaY > 0 ? 1.12 : 0.89))); apply(); }, { passive: false });
        canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    }

    function animateViewer() {
        if (wb3d.animId) cancelAnimationFrame(wb3d.animId);
        (function loop() {
            if (!wb3d.renderer || !wb3d.renderer.domElement.isConnected) { wb3d.animId = null; return; }
            wb3d.renderer.render(wb3d.scene, wb3d.camera);
            wb3d.animId = requestAnimationFrame(loop);
        })();
    }

    function clearViewerModel() {
        if (wb3d.model && wb3d.scene) { wb3d.scene.remove(wb3d.model); wb3d.model = null; }
        var hint = drawer.querySelector('.wb-3d-viewer-empty');
        if (hint) hint.style.display = '';
    }

    function fitViewer() {
        if (!wb3d.model) { toastViewer('请先加载һ个ģ型'); return; }
        var box = new THREE.Box3().setFromObject(wb3d.model);
        var size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
        var maxDim = Math.max(size.x, size.y, size.z) || 1;
        var st = wb3d._orbitState;
        st.dist = maxDim * 2.2;
        st.target.set(center.x, center.y, center.z);
        if (wb3d._orbitApply) wb3d._orbitApply();
    }

    function _loadGLTFInto(loader, url, label) {
        var loading = drawer.querySelector('.wb-3d-viewer-loading');
        var empty = drawer.querySelector('.wb-3d-viewer-empty');
        if (loading) loading.style.display = 'flex';
        if (empty) empty.style.display = 'none';
        try {
            loader.load(url, function (gltf) {
                if (loading) loading.style.display = 'none';
                clearViewerModel();
                wb3d.model = gltf.scene;
                wb3d.scene.add(gltf.scene);
                fitViewer();
                showViewerHint(label);
                toastViewer('ģ型已加载');
            }, undefined, function (e) {
                if (loading) loading.style.display = 'none';
                toastViewer('ģ型加载ʧ败：' + ((e && e.message) || e));
            });
        } catch (e2) { if (loading) loading.style.display = 'none'; toastViewer('加载异常：' + (e2.message || e2)); }
    }

    function loadViewerModelFromUrl(url) {
        if (!/\.glb(\?|#|$)/i.test(url) && !/\.gltf(\?|#|$)/i.test(url)) {
            toastViewer('仅֧持 GLB/GLTF 格ʽԤ览：' + url); return;
        }
        ensureViewer(function (err) {
            if (err) { toastViewer('查看器初ʼ化ʧ败：' + (err.message || err)); return; }
            _loadGLTFInto(new THREE.GLTFLoader(), url, url);
        });
    }

    function loadViewerModelFromData(dataUrl) {
        ensureViewer(function (err) {
            if (err) { toastViewer('查看器初ʼ化ʧ败：' + (err.message || err)); return; }
            _loadGLTFInto(new THREE.GLTFLoader(), dataUrl, '本地文件');
        });
    }

    function showViewerHint(src) {
        var el = drawer.querySelector('.wb-3d-viewer-hint');
        if (el) { el.textContent = src || ''; el.style.display = ''; }
    }

    function toastViewer(msg) {
        try { if (window.App && App._toast) App._toast(msg); } catch (e) {}
    }

    api.bindModel3D = function (root) {
        drawer = root;
        var panel = drawer.querySelector('.wb-3d-panel');
        if (!panel) return;
        var file = panel.querySelector('.wb-3d-viewer-file');
        if (!file) return;
        file.addEventListener('change', function () {
            var f = file.files && file.files[0]; if (!f) return;
            var r = new FileReader(); r.onload = function () { loadViewerModelFromData(r.result); }; r.readAsDataURL(f);
        });
        panel.addEventListener('dragover', function (e) { e.preventDefault(); });
        panel.addEventListener('drop', function (e) {
            e.preventDefault();
            var f = e.dataTransfer.files && e.dataTransfer.files[0];
            if (f && /\.(glb|gltf)$/i.test(f.name)) { var r = new FileReader(); r.onload = function () { loadViewerModelFromData(r.result); }; r.readAsDataURL(f); }
        });
        panel.querySelector('.wb-3d-btn-fit').addEventListener('click', fitViewer);
        panel.querySelector('.wb-3d-btn-grid').addEventListener('click', function () {
            wb3d.gridOn = !wb3d.gridOn; if (wb3d.grid) wb3d.grid.visible = wb3d.gridOn;
            this.textContent = wb3d.gridOn ? '# 网格 开' : '# 网格 关';
        });
        panel.querySelector('.wb-3d-btn-wire').addEventListener('click', function () {
            wb3d.wire = !wb3d.wire;
            if (wb3d.model) wb3d.model.traverse(function (o) { if (o.isMesh && o.material) { var ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(function (m) { m.wireframe = wb3d.wire; }); } });
            this.textContent = wb3d.wire ? '◈ 线框 开' : '◈ 线框 关';
        });
    };


    // 对外 API：AI 生成完成后调用（window.WB3DViewer.load(url)）
    window.WB3DViewer = {
        load: function (url) { loadViewerModelFromUrl(url); },
        loadData: function (dataUrl) { loadViewerModelFromData(dataUrl); },
        clear: clearViewerModel
    };
})();
