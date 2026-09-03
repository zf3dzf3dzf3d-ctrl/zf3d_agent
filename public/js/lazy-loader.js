// ========== lazy-loader.js -  JS  ==========

//  mermaid 

//   LazyLoader.load('mermaid', function () { mermaid.initialize(...); ... });

//  <script> ?v= ڧ

// /

(function () {

    'use strict';



    // index.html  -> { file: , v:  }

    //  window.LAZY_SCRIPTS = { mermaid: {file:'mermaid.min.js', v:'93e5'}, hljs: {...} }

    function fileOf(globalName) {

        var map = window.LAZY_SCRIPTS || {};

        var entry = map[globalName];

        if (!entry) return null;

        return typeof entry === 'string' ? entry : entry.file;

    }

    function verOf(globalName) {

        var entry = (window.LAZY_SCRIPTS || {})[globalName];

        return (entry && typeof entry === 'object' && entry.v) ? '?v=' + entry.v : '';

    }



    var state = {};   // name -> 'loading' | 'loaded'



    function ensureScript(name, cb) {
        var file = fileOf(name);
        if (!file) { console.warn('[LazyLoader] 未注册:', name); try { cb(new Error('unregistered: ' + name)); } catch (e) {} return; }

        // 已加载：直接回调（cb 可能带 err 参数，此处成功传 null）
        if (state[name] === 'loaded' || window[name] !== undefined) { try { cb(null); } catch (e) {} return; }
        if (state[name] === 'error') { try { cb(new Error('load fail: ' + file)); } catch (e) {} return; }

        // 排队等待（无论是否正在 loading 都排队）
        var cbs = pending[name] = pending[name] || [];
        cbs.push(cb);

        if (!state[name]) {
            state[name] = 'loading';
            var s = document.createElement('script');
            s.src = 'js/' + file + verOf(name);
            s.onload = function () {
                state[name] = 'loaded';
                console.log('[LazyLoader] loaded:', file);
                var q = pending[name] || []; pending[name] = [];
                q.forEach(function (f) { try { f(null); } catch (e) {} });
            };
            s.onerror = function () {
                console.error('[LazyLoader] 加载失败:', file);
                state[name] = 'error';
                var q = pending[name] || []; pending[name] = [];
                q.forEach(function (f) { try { f(new Error('load fail: ' + file)); } catch (e) {} });
            };
            document.head.appendChild(s);
        }
    }

    // 超时保护：30 秒仍未 loaded 视为失败，防止回调永久挂起
    var pending = {}; // name -> [cb]
    function watchTimeout(name) {
        var t0 = Date.now();
        var t = setInterval(function () {
            if (state[name] !== 'loading') { clearInterval(t); return; }
            if (Date.now() - t0 > 30000) {
                clearInterval(t);
                state[name] = 'error';
                var q = pending[name] || []; pending[name] = [];
                q.forEach(function (f) { try { f(new Error('timeout')); } catch (e) {} });
            }
        }, 1000);
    }

    // （旧实现的等待循环已并入上面）



    window.LazyLoader = {

        /**

         *  cb

         * @param {string} name window.LAZY_SCRIPTS 

         * @param {Function} cb 

         */

        load: function (name, cb) {
            if (!cb) cb = function () {};
            watchTimeout(name);
            if (window[name] !== undefined && window[name] !== null) { try { cb(null); } catch (e) {} return; }
            ensureScript(name, cb);
        },

        // 

        prefetch: function (name) {

            var file = fileOf(name);

            if (!file || window[name] !== undefined) return;

            var l = document.createElement('link');

            l.rel = 'prefetch';

            l.href = 'js/' + file;

            document.head.appendChild(l);

        }

    };

})();

