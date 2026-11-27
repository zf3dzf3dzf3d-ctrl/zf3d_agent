# -*- coding: utf-8 -*-
"""bridge.mcp：跨智能体互认桥（S6.6）。

对外暴露 MCP 风格 JSON 端点（POST /api/bridge/mcp）：
  {"op":"tools/list"}            -> 内核已注册工具清单（name/description）
  {"op":"tools/call","name":..,"params":..} -> 调用内核工具，返回统一信封
  {"op":"manifest"}              -> 本智能体插件清单（互认握手）
门禁：X-Plugin-Token（内核级 verify_admin_token），与 zf-console 同门。
往返 DoD：同协议客户端调 tools/list+tools/call 与内核直调结果 diff 为空。
"""
import json


def _json(h, obj, code=200):
    out = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    h.send_response(code)
    h.send_header("Content-Type", "application/json; charset=utf-8")
    h.send_header("Content-Length", str(len(out)))
    h.end_headers()
    h.wfile.write(out)


def _body(h):
    try:
        ln = int(h.headers.get("Content-Length", 0) or 0)
        if ln:
            # 【连接黑洞防御 2026-11-25】入口 _drain_body 已读走 body，二次裸读 rfile.read 永久阻塞；走缓存口径
            return json.loads(h._cached_body(ln).decode("utf-8", "ignore"))
    except Exception:
        pass
    return {}


def setup(ctx):
    from routes.dispatcher import route_post

    def _handle(h, path, query):
        if not ctx.verify_admin_token(h):
            return _json(h, {"ok": False, "error": "need X-Plugin-Token"}, 403)
        b = _body(h)
        op = b.get("op", "")
        k = ctx._kernel
        if op == "manifest":
            return _json(h, {"ok": True, "agent": "zf-infinite",
                             "spec": "bridge.mcp@1",
                             "plugins": [p.get("id") for p in ctx.plugin.list()]})
        if op == "tools/list":
            return _json(h, {"ok": True, "tools": sorted(k.tools.keys())})
        if op == "tools/call":
            tool = k.tools.get(str(b.get("name", "")))
            if not tool:
                return _json(h, {"ok": False, "error": "tool not found"})
            try:
                return _json(h, {"ok": True, "result": tool["exec"](b.get("params", {}) or {})})
            except Exception as e:
                return _json(h, {"ok": False, "error": str(e)})
        return _json(h, {"ok": False, "error": "unknown op %r" % op}, 400)

    route_post("/api/bridge/mcp")(_handle)
    ctx.log.info("bridge.mcp ready")


def teardown(ctx):
    ctx.log.info("bridge.mcp teardown")
