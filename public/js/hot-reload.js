/**
 * 热更新客户端 (Hot Reload Client)
 *
 * 功能：
 * 1. 通过 SSE 连接后端，实时接收文件变更通知
 * 2. Python 文件变更 → Toast 提示后端已重载
 * 3. JS/CSS 文件变更 → 动态替换 <script>/<link> 标签，无需刷新页面
 * 4. 支持手动触发重载
 *
 * 设计要点：
 * - SSE 断线自动重连（3秒后）
 * - JS 动态替换：移除旧 <script> 标签 → 创建新 <script> 标签（带时间戳防缓存）
 * - CSS 动态替换：直接修改 <link> 标签的 href（带时间戳防缓存）
 * - 第三方库（highlight/mermaid/marked）不自动热更新，需手动刷新
 * - 热更新自身的 JS 也不自动热更新（避免递归）
 */

(function() {
    'use strict';

    const HOT_RELOAD = {
        // SSE 连接
        _sse: null,
        _connected: false,
        _reconnectTimer: null,

        // 不自动热更新的文件（第三方库 + 自身）
        _skipFiles: [
            'js/highlight.min.js',
            'js/mermaid.min.js',
            'js/marked.min.js',
            'js/hot-reload.js',
            // 临时扫描脚本不是浏览器入口，禁止热更新注入。
            'js/_scan.js',
        ],

        // 热更新状态
        _status: null,

        // ===== 指数退避重连策略 =====
        // 第 1 次：1s；第 2 次：2s；第 3 次：4s；... 最多 30s
        // 抖动 ±20% 避免多窗口同时重连打爆后端
        _reconnectAttempts: 0,
        _maxReconnectAttempts: 12,        // 12 次后放弃 (累计 ~4 分钟)
        _baseDelay: 1000,                 // 起始 1s
        _maxDelay: 30000,                 // 上限 30s
        _probeInterval: 30000,            // 探活间隔
        _probeTimer: null,

        init() {
            this._connect();
            // 探活：30s 内从未连接成功过，强制触发重连
            this._probeTimer = setInterval(() => {
                if (!this._connected) {
                    this._connect();
                }
            }, this._probeInterval);
        },

        // ===== SSE 连接 =====
        _connect() {
            // 清理旧的 EventSource 和排队的 timer（防止多路并存/重入）
            if (this._sse) {
                try { this._sse.close(); } catch (e) {}
                this._sse = null;
            }
            if (this._reconnectTimer) {
                clearTimeout(this._reconnectTimer);
                this._reconnectTimer = null;
            }

            try {
                this._sse = new EventSource('/api/hot-reload/sse');

                this._sse.onopen = () => {
                    const wasReconnect = this._reconnectAttempts > 0;
                    this._connected = true;
                    this._reconnectAttempts = 0;  // 成功就连上 → 重置退避计数

                    this._setStatus('connected');
                };

                this._sse.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        this._handleMessage(data);
                    } catch (e) {
                        console.warn('[HotReload] 解析消息失败:', e);
                    }
                };

                this._sse.onerror = (event) => {
                    // EventSource 的 onerror 有两种 readyState:
                    //   0 = CONNECTING: 浏览器正在自动重连，不用我们插手
                    //   2 = CLOSED:     浏览器已放弃，需要我们自己接管
                    const readyState = this._sse ? this._sse.readyState : 2;
                    console.warn(`[HotReload] SSE 异常 (readyState=${readyState})`, event);

                    if (this._connected) {
                        this._connected = false;
                        this._setStatus('reconnecting');
                    }

                    if (readyState === 2) {
                        // 浏览器放弃，我们来排程退避重连
                        this._scheduleReconnect();
                    }
                    // readyState === 0 时浏览器自带重连机制，不重复排程
                };
            } catch (e) {
                console.warn('[HotReload] SSE 连接失败:', e);
                this._setStatus('error');
                this._scheduleReconnect();
            }
        },

        // ===== 指数退避调度 =====
        _scheduleReconnect() {
            if (this._reconnectTimer) return;  // 已有重连任务在排

            if (this._reconnectAttempts >= this._maxReconnectAttempts) {
                console.error(`[HotReload] 已重试 ${this._reconnectAttempts} 次，放弃。请检查后端服务。`);
                this._setStatus('failed');
                return;
            }

            // 公式：min(baseDelay * 2^attempts, maxDelay) + 随机抖动 ±20%
            const attempt = this._reconnectAttempts;
            const base = Math.min(this._baseDelay * Math.pow(2, attempt), this._maxDelay);
            const jitter = base * 0.2 * (Math.random() * 2 - 1);
            const delay = Math.max(500, Math.floor(base + jitter));

            this._reconnectAttempts++;

            this._reconnectTimer = setTimeout(() => {
                this._reconnectTimer = null;
                this._connect();
            }, delay);
        },

        // ===== 状态指示 =====
        _setStatus(state) {
            // state: 'connected' | 'reconnecting' | 'failed' | 'error'
            this._status = state;
            // 暴露给调试 & 其他模块订阅
            window.__hotReloadStatus = state;
            window.dispatchEvent(new CustomEvent('hotreload-status', { detail: { state } }));
        },

        // ===== 消息处理 =====
        _handleMessage(data) {
            switch (data.type) {
                case 'connected':
                    // Connection acknowledgement is intentionally silent.
                    break;

                case 'python_reload':
                    if (data.success) {
                        this._showToast('后端模块已热更新', 'success', 
                            data.files.map(f => f.file).join(', '));
                    } else {
                        const failedFiles = data.files.filter(f => !f.ok).map(f => f.file).join(', ');
                        this._showToast('后端重载失败', 'error', failedFiles);
                    }
                    break;

                case 'backend_reloaded':
                    this._showToast('后端已热更新', 'success', data.files.join(', '));
                    break;

                case 'static_reload':
                    this._handleStaticReload(data.files);
                    break;

                default:
            }
        },

        // ===== 静态文件热更新 =====
        _handleStaticReload(files) {
            const jsFiles = [];
            const cssFiles = [];

            files.forEach(f => {
                // 跳过不需要热更新的文件
                if (this._skipFiles.includes(f)) {
                    return;
                }
                if (f.endsWith('.js')) {
                    jsFiles.push(f);
                } else if (f.endsWith('.css')) {
                    cssFiles.push(f);
                }
            });

            if (jsFiles.length > 0) {
                jsFiles.forEach(f => this._reloadJS(f));
            }

            if (cssFiles.length > 0) {
                cssFiles.forEach(f => this._reloadCSS(f));
            }
        },

        /**
         * 动态重载 JS 文件
         * 策略：找到对应的 <script> 标签 → 移除 → 创建新 <script> 标签（带时间戳）
         */
        _reloadJS(filePath) {
            const scripts = document.querySelectorAll('script[src]');
            let found = false;

            scripts.forEach(script => {
                const src = script.getAttribute('src');
                const cleanSrc = src.split('?')[0];
                if (cleanSrc === filePath || cleanSrc.endsWith('/' + filePath) || cleanSrc === filePath.replace(/^\//, '')) {
                    found = true;
                    // 创建新 script 标签
                    const newScript = document.createElement('script');
                    newScript.src = filePath + '?v=' + Date.now();
                    // 复制属性
                    if (script.type) newScript.type = script.type;
                    // 移除旧标签，插入新标签
                    script.parentNode.insertBefore(newScript, script);
                    script.parentNode.removeChild(script);
                }
            });

            if (!found) {
                // 仅重载页面已引用的脚本；不能自动执行任意新增 JS，
                // 否则 public 中的 Node 调试脚本会被浏览器加载并报 require/重复声明错误。
            }
        },

        /**
         * 动态重载 CSS 文件
         * 策略：找到对应的 <link> 标签 → 更新 href（带时间戳）
         */
        _reloadCSS(filePath) {
            const links = document.querySelectorAll('link[rel="stylesheet"]');
            let found = false;
            
            links.forEach(link => {
                const href = link.getAttribute('href');
                const cleanHref = href.split('?')[0];
                if (cleanHref === filePath || cleanHref.endsWith('/' + filePath) || cleanHref === filePath.replace(/^\//, '')) {
                    found = true;
                    // 更新 href（带时间戳防缓存）
                    link.href = filePath + '?v=' + Date.now();
                }
            });

            if (!found) {
                const newLink = document.createElement('link');
                newLink.rel = 'stylesheet';
                newLink.href = filePath + '?v=' + Date.now();
                document.head.appendChild(newLink);
            }
        },

        // ===== Toast 通知 =====
        _showToast(title, type, detail) {
            const toast = document.createElement('div');
            toast.style.cssText = `
                padding: 12px 20px;
                border-radius: 8px;
                font-size: 13px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
                color: #fff;
                max-width: 400px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.3);
                backdrop-filter: blur(10px);
            `;

            // 背景色
            const colors = {
                success: 'rgba(34, 197, 94, 0.95)',
                error: 'rgba(239, 68, 68, 0.95)',
                info: 'rgba(59, 130, 246, 0.95)',
            };
            toast.style.background = colors[type] || colors.info;

            toast.innerHTML = `
                <div style="font-weight: 600; margin-bottom: 4px;">${title}</div>
                ${detail ? `<div style="opacity: 0.85; font-size: 11px; word-break: break-all;">${detail}</div>` : ''}
            `;

            // 使用全局 ToastStack（左下角堆叠排列）
            if (window.ToastStack) {
                window.ToastStack.show(toast, 3000);
            } else {
                // 回退：直接 fixed 定位到左下角
                toast.style.cssText += 'position:fixed;bottom:16px;left:16px;z-index:999999;transition:all 0.3s ease;opacity:0;transform:translateY(20px);';
                document.body.appendChild(toast);
                requestAnimationFrame(() => {
                    toast.style.opacity = '1';
                    toast.style.transform = 'translateY(0)';
                });
                setTimeout(() => {
                    toast.style.opacity = '0';
                    toast.style.transform = 'translateY(20px)';
                    setTimeout(() => toast.remove(), 300);
                }, 3000);
            }
        },

        // ===== 手动重载 API =====
        reloadModule(moduleName) {
            return fetch('/api/hot-reload/reload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ module: moduleName || null })
            }).then(r => r.json());
        },

        // ===== 查询状态 =====
        getStatus() {
            return fetch('/api/hot-reload/status')
                .then(r => r.json());
        }
    };

    // 导出到全局
    window.HotReload = HOT_RELOAD;

    // DOM 加载完成后自动初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => HOT_RELOAD.init());
    } else {
        HOT_RELOAD.init();
    }


})();
