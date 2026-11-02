# -*- coding: utf-8 -*-
"""
内置持久化浏览器服务（免安装，随项目包复制即用）
- 浏览器内核：python/browsers（PLAYWRIGHT_BROWSERS_PATH 指向项目内，不写系统目录）
- 登录态：browser_data/profile（持久化，登录一次长期有效）
- 浏览记忆：browser_data/memory（每次 /open 自动存摘要，可检索）
- HTTP 服务：http://127.0.0.1:8765
架构说明：Playwright sync API 绑定单线程，所有浏览器操作经内部工作线程队列串行执行。
接口：
  GET  /status                -> 浏览器状态
  POST /open                  {"url": "..."}                       打开页面（自动存记忆）
  POST /open                  {"url": "...", "incognito": true}    无痕打开（不留 Cookie/历史，不入记忆）
  POST /html                  {"url": "..."}                       返回原始 HTML
  POST /click                 {"selector": "..."}                  点击元素
  POST /type                  {"selector": "...", "text": "..."}   输入文本
  POST /screenshot            {"url": "..."}                       截图，返回路径
  POST /eval                  {"script": "..."}                    在页面执行 JS
  POST /incognito/close       {}                                   销毁无痕上下文
  GET  /memory?keyword=xx&limit=20                                 检索浏览记忆（空关键词=最近）
  POST /memory/get            {"id": 123}                          读单条记忆
  POST /memory/clear          {}                                   清空浏览记忆
启动参数：
  python browser_service.py [端口]
  默认有头模式（可见窗口），加 --headless 切后台
"""
import os, sys, json, time, queue, threading
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import memory_store

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(BASE))  # 项目根（tools 的上一级）
os.environ["PLAYWRIGHT_BROWSERS_PATH"] = os.path.join(ROOT, "python", "browsers")

from playwright.sync_api import sync_playwright

PROFILE = os.path.join(BASE, "browser_data", "profile")
HEADLESS = "--headless" in sys.argv
PORT = 8765
for a in sys.argv[1:]:
    if a.isdigit():
        PORT = int(a)

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

# ---------- 工作线程：所有 Playwright 操作在此线程执行 ----------
_pw = None
_ctx = None        # 持久登录上下文
_incog_browser = None
_incog_ctx = None  # 无痕临时上下文
_task_q = queue.Queue()


def _worker():
    global _pw, _ctx, _incog_browser, _incog_ctx
    _pw = sync_playwright().start()
    os.makedirs(PROFILE, exist_ok=True)
    _ctx = _pw.chromium.launch_persistent_context(
        PROFILE,
        headless=HEADLESS,
        viewport={"width": 1366, "height": 900},
        user_agent=UA,
        args=["--disable-blink-features=AutomationControlled"],
    )
    while True:
        fn, result_q = _task_q.get()
        try:
            result_q.put((fn(), None))
        except Exception as e:
            result_q.put((None, str(e)))


def run_browser(fn, timeout=90):
    """把浏览器操作提交到工作线程执行，返回结果或抛异常"""
    result_q = queue.Queue()
    _task_q.put((fn, result_q))
    try:
        res, err = result_q.get(timeout=timeout)
    except queue.Empty:
        raise TimeoutError("浏览器操作超时")
    if err:
        raise RuntimeError(err)
    return res


def _main_page():
    return _ctx.pages[0] if _ctx.pages else _ctx.new_page()


def _goto(url, incognito=False, timeout=30):
    if incognito:
        global _incog_browser, _incog_ctx
        if _incog_ctx is None:
            _incog_browser = _pw.chromium.launch(
                headless=HEADLESS, args=["--disable-blink-features=AutomationControlled"])
            _incog_ctx = _incog_browser.new_context(
                viewport={"width": 1366, "height": 900}, user_agent=UA)
        page = _incog_ctx.new_page()
    else:
        page = _main_page()
    page.goto(url, timeout=timeout * 1000, wait_until="domcontentloaded")
    time.sleep(1.5)
    return page


def _close_incognito():
    global _incog_browser, _incog_ctx
    if _incog_browser is not None:
        try:
            _incog_browser.close()
        except Exception:
            pass
    _incog_browser = _incog_ctx = None


def _get_status():
    p = _main_page()
    return {"ok": True, "headless": HEADLESS, "current_url": p.url,
            "title": p.title(), "profile": PROFILE,
            "memory_count": len(memory_store.search("", limit=10**9))}


def _open(d):
    incog = bool(d.get("incognito"))
    page = _goto(d["url"], incognito=incog)
    title = page.title()
    text = page.inner_text("body")[:20000]
    url = page.url
    if not incog:
        memory_store.remember(url, title, text)
    if incog:
        try:
            page.close()
        except Exception:
            pass
    return {"ok": True, "url": url, "title": title, "text": text, "incognito": incog}


def _html(d):
    page = _goto(d["url"])
    return {"ok": True, "url": page.url, "title": page.title(),
            "html": page.content()[:200000]}


def _click(d):
    page = _main_page()
    page.click(d["selector"], timeout=15000)
    time.sleep(1)
    return {"ok": True, "url": page.url}


def _type(d):
    page = _main_page()
    page.fill(d["selector"], d["text"], timeout=15000)
    return {"ok": True}


def _screenshot(d):
    page = _goto(d["url"]) if d.get("url") else _main_page()
    fp = os.path.join(BASE, "screenshots", f"shot_{int(time.time())}.png")
    os.makedirs(os.path.dirname(fp), exist_ok=True)
    page.screenshot(path=fp, full_page=True)
    return {"ok": True, "file": fp}


def _eval(d):
    page = _main_page()
    return {"ok": True, "result": page.evaluate(d["script"])}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, data, code=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n).decode("utf-8")) if n else {}

    def do_GET(self):
        try:
            path, _, query = self.path.partition("?")
            if path == "/status":
                self._json(run_browser(_get_status))
            elif path == "/memory":
                q = parse_qs(query)
                recs = memory_store.search(q.get("keyword", [""])[0],
                                           int(q.get("limit", ["20"])[0]))
                self._json({"ok": True, "count": len(recs), "records": recs})
            else:
                self._json({"ok": False, "error": "unknown path"}, 404)
        except Exception as e:
            self._json({"ok": False, "error": str(e)}, 500)

    def do_POST(self):
        try:
            d = self._body()
            path = self.path
            if path == "/open":
                self._json(run_browser(lambda: _open(d)))
            elif path == "/html":
                self._json(run_browser(lambda: _html(d)))
            elif path == "/click":
                self._json(run_browser(lambda: _click(d)))
            elif path == "/type":
                self._json(run_browser(lambda: _type(d)))
            elif path == "/screenshot":
                self._json(run_browser(lambda: _screenshot(d)))
            elif path == "/eval":
                self._json(run_browser(lambda: _eval(d)))
            elif path == "/incognito/close":
                self._json(run_browser(_close_incognito))
            elif path == "/memory/get":
                rec = memory_store.get(int(d.get("id", 0)))
                self._json({"ok": rec is not None, "record": rec})
            elif path == "/memory/clear":
                memory_store.clear()
                self._json({"ok": True})
            else:
                self._json({"ok": False, "error": "unknown path"}, 404)
        except Exception as e:
            self._json({"ok": False, "error": str(e)}, 500)


if __name__ == "__main__":
    # 单实例保护：先探测端口是否已有 browser_service 在跑（初始化浏览器耗时较长，
    # 若不先检测，第二个实例会在初始化期间误以为服务未启动而重复监听同一端口）
    import urllib.request, socket
    try:
        s = socket.create_connection(("127.0.0.1", PORT), timeout=1)
        s.close()
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/status", timeout=3) as r:
            if r.status == 200:
                print(f"[browser_service] 端口 {PORT} 已有实例在运行，本实例退出。")
                raise SystemExit(0)
    except SystemExit:
        raise
    except Exception:
        pass  # 端口空闲，正常启动
    print(f"[browser_service] 端口={PORT} 有头模式={not HEADLESS}")
    print(f"[browser_service] 登录数据目录: {PROFILE}")
    t = threading.Thread(target=_worker, daemon=True)
    t.start()
    run_browser(lambda: True, timeout=120)  # 等浏览器就绪
    print(f"[browser_service] 服务已就绪: http://127.0.0.1:{PORT}/status")
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.serve_forever()
