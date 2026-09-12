// ========== chatbox-08-drag-export.js - 对话拖拽出浏览器 → 桌面生成独立聊天窗口 ==========
// 功能：按住对话框标题栏「导出把手」拖出浏览器窗口，落到桌面/任意文件夹，
//       生成「对话名_独立窗口.pyw」—— 双击即弹出一个**不依赖浏览器**的独立聊天窗口
//       （tkinter 实现，风格同 Ctrl+~ 轮盘：黑底半透明、流式回答），
//       内嵌本对话全部历史消息，且可继续对话（走本地 /api/proxy_stream）。
// 原理：dragstart 时向 dataTransfer 塞入现场生成的 File 对象（Chrome/Edge 支持拖出落盘）。
(function () {
    'use strict';

    // ---------- 收集对话历史 ----------
    function collectMessages(chat, box) {
        var msgs = [];
        try {
            if (typeof Store !== 'undefined' && Store.getMessages) {
                msgs = (Store.getMessages(chat.id) || []).slice();
            }
        } catch (e) {}
        if (!msgs.length && box) {
            var body = box.querySelector('.chatbox-body');
            if (body) {
                body.querySelectorAll('.msg').forEach(function (m) {
                    var who = m.classList.contains('user') ? 'user' : 'assistant';
                    msgs.push({ role: who, content: m.textContent || '' });
                });
            }
        }
        var out = [];
        msgs.forEach(function (m) {
            var role = m.role || 'user';
            if (role === 'tool_call' || role === 'tool' || m.type === 'tool' || m.type === 'tool_call' || m.type === 'typing') return;
            var content = m.content || '';
            if (typeof content !== 'string') {
                try { content = JSON.stringify(content, null, 2); } catch (e) { content = String(content); }
            }
            out.push({ role: role === 'error' ? 'assistant' : role, content: content });
        });
        return out;
    }

    // ---------- JSON 字符串安全嵌入 Python ----------
    function pyStr(s) {
        return JSON.stringify(s); // JSON 字符串是合法的 Python 字符串字面量（双引号+unicode转义）
    }

    // ---------- 生成独立窗口 .pyw 内容 ----------
    function buildStandalonePy(title, model, msgs) {
        var L = [];
        L.push('# -*- coding: utf-8 -*-');
        L.push('# 独立对话窗口（由 朱峰社区智能体 拖拽生成）— 双击运行，无需浏览器');
        L.push('# 对话：' + title + (model ? ('  |  模型: ' + model) : ''));
        L.push('# 继续对话需保持智能体主服务运行（本地代理 /api/proxy_stream）');
        L.push('import json, sys, threading, urllib.request, os, time');
        L.push('import tkinter as tk');
        L.push('from tkinter import font as tkfont');
        L.push('');
        L.push('TITLE  = ' + pyStr(title));
        L.push('MODEL  = ' + pyStr(model));
        L.push('PORT   = 8502  # 与主服务 private/port.json 保持一致，改端口时同步修改');
        L.push('HISTORY = ' + pyStr(JSON.stringify(msgs)));
        L.push('');
        L.push('def _port():');
        L.push('    # 优先读主服务端口配置，读不到用内嵌默认');
        L.push('    try:');
        L.push('        for base in (os.path.dirname(os.path.abspath(__file__)),):');
        L.push('            p = os.path.join(base, "private", "port.json")');
        L.push('            if os.path.exists(p):');
        L.push('                return json.load(open(p, encoding="utf-8")).get("api_port") or PORT');
        L.push('    except Exception:');
        L.push('        pass');
        L.push('    return PORT');
        L.push('');
        L.push('class App:');
        L.push('    def __init__(self):');
        L.push('        self.history = json.loads(HISTORY)');
        L.push('        self.port = _port()');
        L.push('        self.root = tk.Tk()');
        L.push('        self.root.title(TITLE)');
        L.push('        try:');
        L.push('            import ctypes');
        L.push('            ctypes.windll.shcore.SetProcessDpiAwareness(2)');
        L.push('        except Exception:');
        L.push('            pass');
        L.push('        # 窗口弹在鼠标当前位置（松手即见窗，无缝衔接）');
        L.push('        try:');
        L.push('            import ctypes.wintypes');
        L.push('            p = ctypes.wintypes.POINT()');
        L.push('            ctypes.windll.user32.GetCursorPos(ctypes.byref(p))');
        L.push('            w, h = 560, 680');
        L.push('            x = max(0, min(p.x - w // 2, self.root.winfo_screenwidth() - w))');
        L.push('            y = max(0, min(p.y - 20, self.root.winfo_screenheight() - h))');
        L.push('            self.root.geometry(f"{w}x{h}+{x}+{y}")');
        L.push('        except Exception:');
        L.push('            self.root.geometry("560x680")');
        L.push('        self.root.configure(bg="#141420")');
        L.push('        self._build()');
        L.push('        threading.Thread(target=self._replay_history, daemon=True).start()');
        L.push('');
        L.push('    # ---------- UI ----------');
        L.push('    def _build(self):');
        L.push('        top = tk.Frame(self.root, bg="#1c1c28", height=42)');
        L.push('        top.pack(fill="x")');
        L.push('        top.pack_propagate(False)');
        L.push('        tk.Label(top, text="  " + TITLE, bg="#1c1c28", fg="#aaaacc",');
        L.push('                 font=("Microsoft YaHei UI", 11, "bold")).pack(side="left")');
        L.push('        sub = MODEL or ""');
        L.push('        tk.Label(top, text=sub + "  [独立窗口 · 服务关闭后只读]  ", bg="#1c1c28",');
        L.push('                 fg="#555577", font=("Microsoft YaHei UI", 8)).pack(side="right")');
        L.push('');
        L.push('        self.txt = tk.Text(self.root, bg="#141420", fg="#ddddee", wrap="word",');
        L.push('                           bd=0, padx=14, pady=10,');
        L.push('                           font=("Microsoft YaHei UI", 10), state="disabled")');
        L.push('        self.txt.pack(fill="both", expand=True)');
        L.push('        self.txt.tag_config("u", foreground="#7ec8ff", font=("Microsoft YaHei UI", 10, "bold"))');
        L.push('        self.txt.tag_config("a", foreground="#c8c8ee")');
        L.push('        self.txt.tag_config("sys", foreground="#555577", font=("Microsoft YaHei UI", 8), justify="center")');
        L.push('        self.txt.tag_config("stream", foreground="#ffffff")');
        L.push('');
        L.push('        bar = tk.Frame(self.root, bg="#1c1c28")');
        L.push('        bar.pack(fill="x")');
        L.push('        self.input = tk.Text(bar, height=3, bg="#1e1e30", fg="#eeeef4",');
        L.push('                             insertbackground="#aaaacc", bd=0, padx=10, pady=8,');
        L.push('                             font=("Microsoft YaHei UI", 10))');
        L.push('        self.input.pack(side="left", fill="both", expand=True, padx=(10, 6), pady=10)');
        L.push('        self.input.bind("<Return>", self._on_return)');
        L.push('        self.send = tk.Button(bar, text="发送", command=self._send,');
        L.push('                              bg="#3a3a52", fg="#ffffff", activebackground="#4a4a68",');
        L.push('                              activeforeground="#ffffff", relief="flat", width=8,');
        L.push('                              font=("Microsoft YaHei UI", 10, "bold"), cursor="hand2")');
        L.push('        self.send.pack(side="right", padx=(0, 10), pady=10, ipady=6)');
        L.push('');
        L.push('    def _on_return(self, ev):');
        L.push('        if ev.state & 0x0001:  # Shift+Enter 换行');
        L.push('            return None');
        L.push('        self.root.after_idle(self._send)');
        L.push('        return "break"');
        L.push('');
        L.push('    # ---------- 历史 ----------');
        L.push('    def _replay_history(self):');
        L.push('        self._ui(lambda: self._append("sys", "— 历史记录 · 共 %d 条 —" % len(self.history)))');
        L.push('        for m in self.history:');
        L.push('            tag = "u" if m.get("role") == "user" else "a"');
        L.push('            who = "🧑 用户" if tag == "u" else "🤖 助手"');
        L.push('            self._ui(lambda t=tag, w=who, c=m.get("content", ""): self._append(t, w + "\\n" + c))');
        L.push('        self._ui(self._scroll)');
        L.push('');
        L.push('    # ---------- 发送/流式 ----------');
        L.push('    def _send(self):');
        L.push('        text = self.input.get("1.0", "end").strip()');
        L.push('        if not text or self._busy:');
        L.push('            return');
        L.push('        self._busy = True');
        L.push('        self.send.config(state="disabled", text="…")');
        L.push('        self.input.delete("1.0", "end")');
        L.push('        self._ui(lambda: self._append("u", "🧑 用户\\n" + text))');
        L.push('        self.history.append({"role": "user", "content": text})');
        L.push('        threading.Thread(target=self._ask, args=(text,), daemon=True).start()');
        L.push('');
        L.push('    def _ask(self, text):');
        L.push('        full = []');
        L.push('        def on_chunk(s):');
        L.push('            full.append(s)');
        L.push('            self._ui(lambda s=s: self._stream_append(s))');
        L.push('        err = None');
        L.push('        try:');
        L.push('            body = {"messages": [{"role": m.get("role"), "content": m.get("content", "")} for m in self.history[-40:]],');
        L.push('                    "system": "你是朱峰社区智能体的独立对话窗口，简洁、专业地回答。", "stream": True}');
        L.push('            req = urllib.request.Request(');
        L.push('                "http://127.0.0.1:%d/api/proxy_stream" % self.port,');
        L.push('                data=json.dumps(body).encode("utf-8"),');
        L.push('                headers={"Content-Type": "application/json"}, method="POST")');
        L.push('            with urllib.request.urlopen(req, timeout=180) as resp:');
        L.push('                for raw in resp:');
        L.push('                    line = raw.decode("utf-8", "ignore").strip()');
        L.push('                    if not line or line == "[DONE]":');
        L.push('                        if line == "[DONE]":');
        L.push('                            break');
        L.push('                        continue');
        L.push('                    if line.startswith("data:"):');
        L.push('                        line = line[5:].strip()');
        L.push('                    if line == "[DONE]":');
        L.push('                        break');
        L.push('                    try:');
        L.push('                        d = json.loads(line)');
        L.push('                    except Exception:');
        L.push('                        on_chunk(line); continue');
        L.push('                    piece = ""');
        L.push('                    if isinstance(d, dict):');
        L.push('                        ch = d.get("choices") or []');
        L.push('                        if ch:');
        L.push('                            delta = ch[0].get("delta") or {}');
        L.push('                            piece = delta.get("content") or ch[0].get("message", {}).get("content") or ""');
        L.push('                        piece = piece or d.get("content") or d.get("text") or ""');
        L.push('                    if piece:');
        L.push('                        on_chunk(piece)');
        L.push('        except Exception as e:');
        L.push('            err = "请求失败（请确认主服务已启动，端口 %d）：%s" % (self.port, e)');
        L.push('        reply = "".join(full) or (err or "（空回复）")');
        L.push('        if err and not full:');
        L.push('            self._ui(lambda: self._append("a", "⚠️ " + err))');
        L.push('        self.history.append({"role": "assistant", "content": reply})');
        L.push('        self._ui(self._done)');
        L.push('');
        L.push('    # ---------- 线程安全 UI ----------');
        L.push('    def _ui(self, fn):');
        L.push('        try:');
        L.push('            self.root.after(0, fn)');
        L.push('        except Exception:');
        L.push('            pass');
        L.push('');
        L.push('    def _append(self, tag, text):');
        L.push('        self.txt.config(state="normal")');
        L.push('        self.txt.insert("end", "\\n" + text + "\\n", tag)');
        L.push('        self.txt.config(state="disabled")');
        L.push('        self._scroll()');
        L.push('');
        L.push('    def _stream_start(self):');
        L.push('        self._streaming = True');
        L.push('        self._ui(lambda: self._append("a", "🤖 助手"))');
        L.push('');
        L.push('    def _stream_append(self, s):');
        L.push('        if not getattr(self, "_streaming", False):');
        L.push('            self._streaming = True');
        L.push('            self._append("a", "🤖 助手")');
        L.push('        self.txt.config(state="normal")');
        L.push('        self.txt.insert("end", s, "stream")');
        L.push('        self.txt.config(state="disabled")');
        L.push('        self._scroll()');
        L.push('');
        L.push('    def _done(self):');
        L.push('        self._streaming = False');
        L.push('        self._busy = False');
        L.push('        self.txt.config(state="normal")');
        L.push('        self.txt.insert("end", "\\n", "a")');
        L.push('        self.txt.config(state="disabled")');
        L.push('        self.send.config(state="normal", text="发送")');
        L.push('        self._scroll()');
        L.push('');
        L.push('    def _scroll(self):');
        L.push('        self.txt.see("end")');
        L.push('');
        L.push('    def run(self):');
        L.push('        self.root.mainloop()');
        L.push('');
        L.push('');
        L.push('if __name__ == "__main__":');
        L.push('    App().run()');
        return L.join('\n');
    }

    // ---------- 文件名安全化 ----------
    function safeFileName(title) {
        var name = (title || '').replace(/[\\/:*?"<>|\r\n]+/g, '_').trim();
        if (!name) name = '对话';
        if (name.length > 50) name = name.slice(0, 50);
        return name + '_独立窗口.pyw';
    }

    // ---------- 绑定导出把手 ----------
    function bindExportHandle(handle, chat, box) {
        handle.setAttribute('draggable', 'true');
        var _lastPy = null;
        handle.addEventListener('dragstart', function (e) {
            try {
                var title = (chat && chat.title) || '对话';
                var model = (chat && chat.modelId) || '';
                var py = buildStandalonePy(title, model, collectMessages(chat, box));
                _lastPy = py;
                var fname = safeFileName(title);
                var file = new File([py], fname, { type: 'text/x-python' });
                if (e.dataTransfer.items && e.dataTransfer.items.add) {
                    e.dataTransfer.items.add(file);
                }
                e.dataTransfer.setData('DownloadURL', 'text/x-python:' + fname + ':' + URL.createObjectURL(new Blob([py], { type: 'text/x-python' })));
                e.dataTransfer.setData('text/plain', py);
                e.dataTransfer.effectAllowed = 'copy';
                _droppedInside = false;
                handle.classList.add('export-dragging');
            } catch (err) {
                console.error('[拖拽独立窗口] dragstart 失败:', err);
            }
        });
        var _droppedInside = false;
        function _markInside() { _droppedInside = true; }
        document.addEventListener('drop', _markInside, true);
        document.addEventListener('dragover', function (e) { _droppedInside = false; }, true);
        handle.addEventListener('dragend', function () {
            handle.classList.remove('export-dragging');
            document.removeEventListener('drop', _markInside, true);
            // 无缝衔接：拖出浏览器（document 上没有发生 drop）→ 直接通知本地服务
            // 用 pythonw 弹出独立窗口，窗口 GetCursorPos 弹在鼠标松手位置，无需落盘双击
            try {
                if (_lastPy && !_droppedInside) {
                    fetch('/api/chatbox-pop', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ py: _lastPy })
                    }).then(function (r) { return r.json(); }).then(function (j) {
                        if (!j || j.成功 === false) console.warn('[拖拽独立窗口] 直接弹出失败:', j && j.错误);
                    }).catch(function (err) {
                        console.warn('[拖拽独立窗口] 直接弹出请求失败:', err);
                    });
                }
            } catch (err) {
                console.warn('[拖拽独立窗口] dragend 处理异常:', err);
            }
            _lastPy = null;
            _droppedInside = false;
        });
        handle.addEventListener('mousedown', function (e) { e.stopPropagation(); });
    }

    // ---------- 全局委托：自动绑定动态创建的把手 ----------
    var obs = null;
    function startObserver() {
        if (obs) return;
        obs = new MutationObserver(function () { scheduleScan(); });
        try { obs.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
    }
    var scanTimer = 0;
    function scheduleScan() {
        if (scanTimer) return;
        scanTimer = setTimeout(function () {
            scanTimer = 0;
            scanHandles();
        }, 120);
    }
    function scanHandles() {
        document.querySelectorAll('.chatbox-header .export-handle:not([data-export-bound])').forEach(function (h) {
            h.setAttribute('data-export-bound', '1');
            var box = h.closest('.chatbox');
            if (!box) return;
            var chat = null;
            try {
                if (typeof Store !== 'undefined' && Store.data && Store.data.chatBoxes) {
                    var boxId = box.id || '';
                    Store.data.chatBoxes.forEach(function (c) {
                        if (!chat && ((c.el && c.el === box) || (c.id && boxId && c.id === boxId))) chat = c;
                    });
                }
            } catch (e) {}
            bindExportHandle(h, chat, box);
        });
    }

    function init() {
        startObserver();
        scheduleScan();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
