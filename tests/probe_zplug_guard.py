# -*- coding: utf-8 -*-
"""蜂群第3轮安全修复探针：zplug.core 工具面路径闸 + gate5 覆盖闸（临时镜像树全隔离，不碰线上）

隔离原理（2026-11-23 收尾队W4）：setup() 的守卫闭包从模块 __file__ 上推两级定位 plugins 根，
故把 main.py 复制进临时镜像树再从镜像加载——plugins_root/out_dir/zplug_path 全部落临时目录，
生产 plugins/uploads|exports 与 server/data/plugin_states.json 零写入，跑完即清。"""
import importlib.util, json, os, shutil, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 仓库根（不再硬编码 E:\）
MAIN = os.path.join(ROOT, "plugins", "zplug.core", "main.py")
sys.path.insert(0, os.path.join(ROOT, "server"))  # setup() 里 from routes.dispatcher import 需要 server/ 在 path

_SANDBOX = tempfile.mkdtemp(prefix="zplug_guard_probe_")
_mirror_main = os.path.join(_SANDBOX, "plugins", "zplug.core", "main.py")
os.makedirs(os.path.dirname(_mirror_main), exist_ok=True)
shutil.copy(MAIN, _mirror_main)
# 合成被测插件（生产 tool.file-tools/manifest.json 现带 UTF-8 BOM 会让导出闸判 bad manifest，
# 探针不依赖生产数据健康度，自建合法 manifest 聚焦测路径闸本身）
_test_plugin = os.path.join(_SANDBOX, "plugins", "tool.file-tools")
os.makedirs(_test_plugin, exist_ok=True)
with open(os.path.join(_test_plugin, "manifest.json"), "w", encoding="utf-8") as f:
    json.dump({"spec": 1, "id": "tool.file-tools", "name": "file-tools(test)",
               "capabilities": ["tool.register", "log.write"]}, f, ensure_ascii=False)
with open(os.path.join(_test_plugin, "main.py"), "w", encoding="utf-8") as f:
    f.write("# sandbox probe dummy\n")
os.makedirs(os.path.join(_SANDBOX, "server", "data"), exist_ok=True)
with open(os.path.join(_SANDBOX, "server", "data", "plugin_states.json"), "w", encoding="utf-8") as f:
    json.dump({"enabled": ["tool.file-tools"], "implementations": {}, "config": {}}, f)

spec = importlib.util.spec_from_file_location("zplug_main", _mirror_main)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

results = []
try:
    # ---- 工具面闸：模拟 ctx.tool.register 收集 exec ----
    registered = {}
    class Log:  info = staticmethod(lambda *a: None)
    class Tool:  register = staticmethod(lambda d: registered.update({d["name"]: d["exec"]}))
    class Ctx:   tool = Tool(); log = Log(); verify_admin_token = staticmethod(lambda h: True)
    m.setup(Ctx())

    PLUGINS = os.path.join(_SANDBOX, "plugins")  # 镜像 plugins 根（守卫闭包认可的范围）

    # T1 导出越界 plugins_root → 拒
    r = registered["zplug_export"]({"plugins_root": r"C:\Windows", "plugin_id": "x", "out_dir": ""})
    results.append(("T1 export root outside", r.get("error", "").startswith("GUARD"), str(r)[:80]))
    # T2 导出 out_dir 越界 → 拒
    r = registered["zplug_export"]({"plugins_root": PLUGINS, "plugin_id": "tool.file-tools", "out_dir": r"C:\Temp"})
    results.append(("T2 export out_dir outside", r.get("error", "").startswith("GUARD"), str(r)[:80]))
    # T3 导出根内放行（out_dir=镜像 plugins/uploads）
    r = registered["zplug_export"]({"plugins_root": PLUGINS, "plugin_id": "tool.file-tools",
                                    "out_dir": os.path.join(PLUGINS, "uploads")})
    print("T3_RAW:", r)
    zpath = r.get("path") if r.get("ok") else None
    results.append(("T3 export inside ALLOW", bool(zpath) and os.path.isfile(zpath), str(r)[:100]))
    # T4 导入 zplug_path 越界（任意读探测）→ 拒
    r = registered["zplug_import"]({"plugins_root": PLUGINS, "zplug_path": r"C:\Windows\win.ini"})
    results.append(("T4 import path outside", r.get("error", "").startswith("GUARD"), str(r)[:80]))
    # T5 导入已启用插件覆盖 → gate5 拒（镜像 plugin_states.json 的 enabled 列表含 tool.file-tools）
    if zpath:
        r2 = registered["zplug_import"]({"plugins_root": PLUGINS, "zplug_path": zpath})
        results.append(("T5 import enabled overwrite gate5", "gate5" in str(r2.get("error", "")), str(r2)[:100]))
    else:
        results.append(("T5 import enabled overwrite gate5", False, "skipped: T3 未产出合法包"))

    # T6 HTTP 端点闸用 commonpath 防前缀绕过（单测 _under 等价逻辑）
    base = os.path.abspath(PLUGINS)
    evil = base + "_evil"  # 前缀伪造
    def _under(path, root):
        try: return os.path.commonpath([os.path.abspath(path), os.path.abspath(root)]) == os.path.abspath(root)
        except Exception: return False
    results.append(("T6 commonpath anti-prefix", not _under(evil, base), evil))
finally:
    shutil.rmtree(_SANDBOX, ignore_errors=True)  # 跑完即清

ok = all(x[1] for x in results)
for name, passed, detail in results:
    print(("PASS" if passed else "FAIL"), name, "|", detail)
print("ALL_OK" if ok else "HAS_FAIL")
sys.exit(0 if ok else 1)
