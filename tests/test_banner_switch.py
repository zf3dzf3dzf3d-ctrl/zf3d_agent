# -*- coding: utf-8 -*-
"""S1-3 双轨切换实测（2026-11-23 随 T8 摘壳契约更新）：验证 _print_banner 优先走 tool.banner 插件。
生产实现已迁 server/server_runtime.py（server.py 2026-11-08 瘦身，不再挂在 server 模块上），
回退策略亦改为「插件不可用时只打一行版本日志」（旧内联 ASCII 横幅已删，见 _print_banner 摘壳注释）。
覆盖：①插件轨正常打印大字横幅 ②printed=False 回退一行版本日志 ③工具缺失回退一行版本日志。"""
import io, sys, os
_SERVER = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'server'))
sys.path.insert(0, _SERVER)  # 相对仓库根推导，不再硬编码 E:\ 绝对路径
os.chdir(_SERVER)

buf = io.StringIO()
_real = sys.stdout
sys.stdout = buf
try:
    import server_runtime as _rt  # noqa —— _print_banner 定义处（2026-11-08 瘦身迁入）
finally:
    sys.stdout = _real

import kernel as _k
_k.boot_plugins()  # 幂等引导（与 _print_banner 内部一致）
_kern = _k.get_kernel()
assert _kern.tools.get("banner_print"), "tool.banner 未启用/未加载，先 enable"
_orig = _kern.tools["banner_print"]

# 场景A：插件轨（内核已引导，tool.banner enabled）→ 大字横幅 + 版本行
sys.stdout = buf = io.StringIO()
_rt._print_banner()
outA = buf.getvalue()
assert "ZF3D Agent" in outA, "场景A未输出横幅: %r" % outA[:200]
assert "██" in outA, "场景A大字缺失"

# 场景B：插件禁用（printed=False）→ 回退一行版本日志（T8 摘壳新契约，不再有内联大字）
_kern.tools["banner_print"] = {**_orig, "exec": lambda p: {"ok": True, "printed": False}}
sys.stdout = buf = io.StringIO()
_rt._print_banner()
outB = buf.getvalue()
assert "ZF3D Agent v" in outB and "仅版本日志" in outB, "场景B未回退版本日志: %r" % outB[:200]
assert "██" not in outB, "场景B不应再有内联大字横幅"
_kern.tools["banner_print"] = _orig

# 场景C：工具消失 → 回退一行版本日志
del _kern.tools["banner_print"]
sys.stdout = buf = io.StringIO()
_rt._print_banner()
outC = buf.getvalue()
assert "ZF3D Agent v" in outC and "仅版本日志" in outC, "场景C未回退版本日志: %r" % outC[:200]
_kern.tools["banner_print"] = _orig

print("A/B/C ALL PASS")
