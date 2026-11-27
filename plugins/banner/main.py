# -*- coding: utf-8 -*-
"""tool.banner v1.0.0 — S1-3 首个内置模块插件化迁移。

前身 server/print_banner.py（死文件，无任何调用方）+ server.py L431/L463 内联横幅。
本插件提供 banner_print 工具：输出 ZF3D Agent 启动横幅（版本号读 private/version.json）。
server.py 内联横幅暂保留双轨（绞杀者模式），待稳定后由 server.py 改调本工具再销毁内联。
"""

_BANNER_LINES = [
    "  ██████████  ██████████  ██████████  ████████        ██      ████████    ██████████  ██      ██  ██████████",
    "        ██    ██                  ██  ██      ██    ██  ██    ██          ██          ████    ██      ██",
    "      ██      ██████████  ██████████  ██      ██  ██████████  ██    ██    ██████████  ██  ██  ██      ██",
    "    ██        ██                  ██  ██      ██  ██      ██  ██    ██    ██          ██    ████      ██",
    "  ██████████  ██          ██████████  ████████    ████████    ████████    ██████████  ██      ██      ██",
]


def _read_version(ctx):
    try:
        import json, os
        root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        vj = os.path.join(root, "private", "version.json")
        if os.path.exists(vj):
            with open(vj, encoding="utf-8-sig") as f:
                return json.load(f).get("version", "")
    except Exception:
        pass
    return ""


def setup(ctx):
    def _banner_print(params):
        if not ctx.config.get("enabled", True):
            return {"ok": True, "printed": False}
        ver = _read_version(ctx) or "unknown"
        out = [""] + _BANNER_LINES + ["                                              ZF3D Agent  v%s" % ver, ""]
        for line in out:
            print(line)
        return {"ok": True, "printed": True, "version": ver}

    ctx.tool.register({
        "name": "banner_print",
        "desc": "输出 ZF3D Agent 启动横幅（大字 + 版本号）",
        "category": "系统",
        "exec": _banner_print,
    })
