# -*- coding: utf-8 -*-
"""插件管理器插件：/api/plugin-manager/* 管理 API（enable/disable/reload/实现切换/配置）。

【2026-11-07 安全整改】管理 API 加独立 token：八端点全部要求 X-Plugin-Token，无旁路。
【2026-11-09 蜂群收口整改】
- local-token 补 Host 头校验（防 DNS rebinding），仅允许回环 Host
- tool-call 加工具白名单（仅插件管理类只读工具，杜绝经此调 shell 类工具）
- _guard 异常 trace 改 BASE_DIR 相对路径落盘（去硬编码盘符）
- 死代码 _auth/_read_body 删除；setup() 拆分 _make_guard/_issue_token/_register_routes
"""
import json
import os
import threading

from util_log import get_logger

log = get_logger('main')
# ui_mounts_report.json 写入互斥锁（T0：R2-1 文件锁，同进程内并发上报串行化）
_REPORT_LOCK = threading.Lock()

# tool-call 白名单：仅允许管理面板用途的只读/受控工具（杜绝 shell 类全权调用面）
_TOOLCALL_WHITELIST = {
    # B1（2026-11-17）：核心插件清单与 kernel_mgr._CORE_PLUGINS 保持同源（防自锁双保险的前端侧）
    "file_info", "find_files", "tree_dir", "search_in_files",
    "read_file", "read_lines", "list_formats",
}

# 核心插件清单已归内核单一真源（server/kernel_mgr.py Kernel._CORE_PLUGINS），
# 此处不再维护副本（T0 修漂移：旧副本 {"zf-console"} 与真 id manager.zf-console 失配，
# core 标记失效）。下发处改经 kernel.core_plugins() 读取。


def _json(handler, obj, code=200):
    out = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(out)))
    handler.end_headers()
    handler.wfile.write(out)


def _trace_log_path():
    """BASE_DIR 相对路径（server/data/_err_trace.log），不再硬编码盘符。"""
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # plugins/ -> 项目根
    return os.path.join(base, "server", "data", "_err_trace.log")


def _normalize_query(query):
    """dispatcher 传来的 q 可能是 ParseResult，规范成 dict。"""
    if isinstance(query, dict):
        return query
    from urllib.parse import parse_qs as _pqs
    return {k: v[0] for k, v in _pqs(getattr(query, "query", "") or "").items()}


def _make_guard(ctx):
    """token 守卫包装器：无有效 token 一律 403，无旁路。
    校验委托 ctx.verify_admin_token（kernel 级统一认证，森林的门在内核）。"""
    def _guard(fn):
        def wrapped(handler, path, query):
            if not ctx.verify_admin_token(handler):
                return _json(handler, {"ok": False, "error": "plugin-manager API 需要 X-Plugin-Token"}, 403)
            try:
                return fn(handler, path, _normalize_query(query))
            except Exception:
                import io as _io
                import traceback as _tb
                with _io.open(_trace_log_path(), "a", encoding="utf-8") as _f:
                    _tb.print_exc(file=_f)
                raise
        return wrapped
    return _guard


def _make_issue_token():
    """本机回环 token 发放：回环 IP + Host 头双校验（防 DNS rebinding），拒 XFF 伪造。"""
    _LOOPBACK_IPS = ("127.0.0.1", "::1", "localhost")
    _LOOPBACK_HOSTS = ("127.0.0.1", "localhost", "::1")

    def _issue_token(h, p, q):
        ip = h.client_address[0] if getattr(h, "client_address", None) else ""
        xfwd = str(h.headers.get("X-Forwarded-For", "") or "").strip()
        host = str(h.headers.get("Host", "") or "").strip().rsplit(":", 1)[0] or h.headers.get("Host", "")
        if ip not in _LOOPBACK_IPS or (xfwd and xfwd not in ("127.0.0.1", "::1")):
            return _json(h, {"ok": False, "error": "token 发放仅限本机回环"}, 403)
        if host not in _LOOPBACK_HOSTS:
            return _json(h, {"ok": False, "error": "Host 校验失败（防 DNS rebinding）"}, 403)
        from kernel_core import get_admin_token
        return _json(h, {"ok": True, "token": get_admin_token()})
    return _issue_token


def _arg(h, q, p, key, default=""):
    """handlers 参数统一取值：兜底用 handler.self.path（含 query）。"""
    from urllib.parse import parse_qs, urlparse
    for src in (getattr(q, "query", "") or "",
                p if isinstance(p, str) else "",
                urlparse(getattr(h, "path", "") or "").query):
        if src and ("=" in src):
            vals = parse_qs(src.split("?", 1)[-1] if "?" in src else src)
            if key in vals:
                return vals[key][0]
    return default


def _register_routes(ctx, route_get, route_post, _guard):
    def _enable(h, p, q):
        pid = _arg(h, q, p, "id")
        if not pid:
            return _json(h, {"ok": False, "error": "id required"})
        _json(h, ctx.plugin.enable(pid))

    def _disable(h, p, q):
        pid = _arg(h, q, p, "id")
        if not pid:
            return _json(h, {"ok": False, "error": "id required"})
        _json(h, ctx.plugin.disable(pid))

    def _reload(h, p, q):
        pid = _arg(h, q, p, "id")
        if not pid:
            return _json(h, {"ok": False, "error": "id required"})
        ctx.plugin.disable(pid)
        _json(h, ctx.plugin.enable(pid))

    def _impl(h, p, q):
        _json(h, ctx.plugin.set_implementation(_arg(h, q, p, "provides"), _arg(h, q, p, "id")))

    def _config(h, p, q):
        pid = _arg(h, q, p, "id")
        if pid:
            ctx._kernel.set_config(pid, _arg(h, q, p, "config", {}) or {})
        _json(h, {"ok": True})

    def _toolcall(h, p, q):
        """【2026-11-09 收窄】白名单内只读工具才可调用，不再提供全工具调用面。"""
        name = _arg(h, q, p, "name")
        if name not in _TOOLCALL_WHITELIST:
            return _json(h, {"ok": False, "error": "tool-call 白名单外工具禁止调用"}, 403)
        tool = ctx._kernel.tools.get(name)
        if not tool:
            return _json(h, {"ok": False, "error": "tool not found"})
        try:
            _json(h, {"ok": True, "result": tool["exec"](json.loads(_arg(h, q, p, "params", "{}") or "{}"))})
        except Exception as e:
            _json(h, {"ok": False, "error": str(e)})

    route_get("/api/plugin-manager/list")(
        _guard(lambda h, p, q: _json(h, {"ok": True, "plugins": [
            # 代码师步骤1（2026-11-17）：core 标记随 list 下发，前端免硬编码 id 特判；
            # T0（2026-11-23）：core 集合改读内核单一真源，本插件不再自持副本
            dict(pl, core=(pl.get("id") in ctx._kernel.core_plugins())) for pl in ctx.plugin.list()
        ]})))
    route_get("/api/plugin-manager/status")(
        _guard(lambda h, p, q: _json(h, {"ok": True, **ctx._kernel.status()})))
    route_post("/api/plugin-manager/enable")(_guard(_enable))
    route_post("/api/plugin-manager/disable")(_guard(_disable))
    route_post("/api/plugin-manager/reload")(_guard(_reload))
    route_post("/api/plugin-manager/set-implementation")(_guard(_impl))
    route_post("/api/plugin-manager/config")(_guard(_config))
    route_post("/api/plugin-manager/tool-call")(_guard(_toolcall))
    # S7 UI 挂载声明（公开只读：仅声明，不含代码内容）
    route_get("/api/plugin-manager/ui-mounts")(
        lambda h, p, q: _json(h, {"ok": True, "ui_mounts": ctx._kernel.ui_mounts}))
    # 本机回环 token 发放（供设置面板插件开关区）
    route_get("/api/plugin-manager/local-token")(_make_issue_token())

    # ===== R1-2（2026-11-20 v3.2）：声明导出上报端点 =====
    # 前端 zf-app-dock.js boot 末尾 POST {source, apps:[{id,name}]}，
    # 落库 server/data/ui_mounts_report.json（可回查的注册事实真源）。
    # 公开写但内容受限：仅收 id/name/source 字符串声明，截断防滥用；无 token
    # （与 ui-mounts GET 同级；不改插件状态，泄漏面=一份本地 JSON）。
    # 写端点安全整改（2026-11-20 安全师【中】）：source 白名单，非白名单 403。
    # 不走 _guard（前端 boot fetch 不带 token，走 guard 会打断上报链路），
    # 以 source=="zf-app-dock" 白名单收口伪造面（安全师建议采纳项）。
    def _ui_mounts_report(handler, path, query):
        try:
            n = int(handler.headers.get("Content-Length") or 0)
        except Exception:
            n = 0
        if n <= 0 or n > 256 * 1024:  # 256KB 上限
            return _json(handler, {"ok": False, "error": "invalid body size"}, 400)
        try:
            data = json.loads(handler._cached_body(n).decode("utf-8", "replace"))
            # 2026-11-20 修复：入口 _drain_body 已预读缓存 body，直接 rfile.read
            # 属二次读，会永久阻塞（连接黑洞，同 domain_batch_ask 修复先例）。
        except Exception as e:
            return _json(handler, {"ok": False, "error": "bad json: %s" % e}, 400)
        if not isinstance(data, dict):
            return _json(handler, {"ok": False, "error": "body must be object"}, 400)
        src = str(data.get("source") or "unknown")[:64]
        if src != "zf-app-dock":  # 来源白名单：只收 dock boot 声明导出（前端 L2947 实值）
            return _json(handler, {"ok": False, "error": "source not allowed"}, 403)
        apps = data.get("apps")
        if not isinstance(apps, list) or not apps:
            return _json(handler, {"ok": False, "error": "apps[] required"}, 400)
        clean = []
        for a in apps[:200]:  # 上限 200 个程序
            if not isinstance(a, dict):
                continue
            clean.append({"id": str(a.get("id") or "")[:64],
                          "name": str(a.get("name") or "")[:128]})
        clean = [a for a in clean if a["id"]]
        rec = {"reported_at": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
               "source": src, "count": len(clean), "apps": clean}
        base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # plugins/zf-console -> 项目根
        out = os.path.join(base, "server", "data", "ui_mounts_report.json")
        # T0（2026-11-23，策划案 R2-1）：写路径加锁 + 原子落盘（temp+replace），
        # 并发上报不再可能交错出坏 JSON
        try:
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with _REPORT_LOCK:
                tmp = out + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(rec, f, ensure_ascii=False, indent=2)
                os.replace(tmp, out)
        except Exception as e:
            return _json(handler, {"ok": False, "error": "persist failed: %s" % e}, 500)
        log.info("[zf-console][ui-mounts-report] source=%s count=%d -> %s" % (src, len(clean), out))
        return _json(handler, {"ok": True, "count": len(clean), "stored": out})
    route_post("/api/plugin-manager/ui-mounts/report")(_ui_mounts_report)


def setup(ctx):
    from routes.dispatcher import route_post, route_get
    _register_routes(ctx, route_get, route_post, _make_guard(ctx))


def teardown(ctx):
    ctx.log.info("zf-console teardown")
