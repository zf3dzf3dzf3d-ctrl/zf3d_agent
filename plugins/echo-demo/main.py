# -*- coding: utf-8 -*-
"""试点工具插件：回声演示。验证 ctx.tool / ctx.http / ctx.event / ctx.store / teardown。"""


def setup(ctx):
    ctx.log.info("echo-demo setup")

    ctx.tool.register({
        "name": "echo_demo",
        "desc": "回声演示：原样返回输入文本",
        "category": "演示",
        "params": {"text": "要回显的文本"},
        "exec": lambda params: {"ok": True, "echo": params.get("text", ""), "greeting": ctx.config.get("greeting")},
    })

    def _http(handler, path, parsed):
        body = {"ok": True, "plugin": "tool.echo-demo", "time": __import__("time").time()}
        try:
            ln = int(handler.headers.get("Content-Length", 0) or 0)
            if ln:
                import json as _j
                # 【连接黑洞防御 2026-11-25】入口 _drain_body 已读走 body，二次裸读 rfile.read 永久阻塞；走缓存口径
                body["recv"] = _j.loads(handler._cached_body(ln).decode("utf-8", "ignore"))
        except Exception:
            pass
        out = __import__("json").dumps(body, ensure_ascii=False).encode("utf-8")
        handler.send_response(200)
        handler.send_header("Content-Type", "application/json; charset=utf-8")
        handler.send_header("Content-Length", str(len(out)))
        handler.end_headers()
        handler.wfile.write(out)

    ctx.http.route("/api/plugin/echo", _http)

    def _on_ping(data):
        return "pong-from-echo"

    ctx.event.on("kernel.ping", _on_ping)
    ctx.store.set("boot_count", (ctx.store.get("boot_count", 0) or 0) + 1)


def teardown(ctx):
    ctx.log.info("echo-demo teardown")
