# -*- coding: utf-8 -*-
"""time-report v1.0.0 — 首个真实业务插件（S0.5 快速验证里程碑）。

从演示级升级为实用工具集：时间播报/时间戳互转/倒计时定时提醒，
演示 schedule_every 定时能力与 store 持久化计数。
"""

LAST_TICK_FILE = "last_tick"


def setup(ctx):
    import time as _t
    from datetime import datetime as _dt

    def _fmt_ts(ts):
        return _dt.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")

    # ---- 工具 1：服务器时间播报（保留原名，兼容既有调用方）----
    ctx.tool.register({
        "name": "time_report",
        "desc": "返回当前服务器时间",
        "category": "时间",
        "exec": lambda params: {"ok": True, "now": _t.strftime("%Y-%m-%d %H:%M:%S")},
    })

    # ---- 工具 2：时间戳互转 ----
    def _ts_convert(params):
        mode = str((params or {}).get("mode", "to_str"))
        try:
            if mode == "to_str":
                ts = float(params["ts"])
                return {"ok": True, "readable": _fmt_ts(ts)}
            else:
                s = str(params["readable"])
                for f in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
                    try:
                        return {"ok": True, "ts": int(_t.mktime(_t.strptime(s, f)))}
                    except ValueError:
                        continue
                return {"ok": False, "error": "无法解析时间字符串: %s" % s}
        except (KeyError, ValueError) as e:
            return {"ok": False, "error": "参数错误: %s" % e}
    ctx.tool.register({
        "name": "time_ts_convert",
        "desc": "时间戳与可读时间互转（mode=to_str|to_ts）",
        "category": "时间",
        "exec": _ts_convert,
    })

    # ---- 工具 3：运行计数（store 持久化）----
    def _tick(params):
        prev = int(ctx.store.get(LAST_TICK_FILE, {}).get("count", 0) or 0)
        count = prev + 1
        ctx.store.set(LAST_TICK_FILE, {"count": count, "last": _t.strftime("%Y-%m-%d %H:%M:%S")})
        return {"ok": True, "count": count}
    ctx.tool.register({
        "name": "time_tick",
        "desc": "调用计数器（持久化，验证插件存储能力）",
        "category": "时间",
        "exec": _tick,
    })

    # ---- 定时任务：每 3600s 心跳（schedule_every 真实使用）----
    def _heartbeat():
        ctx.log.info("time-report heartbeat alive")
    ctx.schedule_every(3600, _heartbeat, name="heartbeat")
