# -*- coding: utf-8 -*-
"""
check_layering.py — 分层方向性护栏（AST 静态分析）

分层规则（高层可 import 低层，反向违规）：
  L3 routes/（含 server/handler_routes.py 等入口分发层）
  L2 根目录业务模块（server/*.py）
  L1 engines/ 与 tools/ 与各引擎子包
  L0 基础层（config/db/path_policy/platform_compat/security 等无依赖模块）

用法：
  python tools/check_layering.py            # 检查，非白名单违规则退出码 1
  python tools/check_layering.py --update   # 把当前全部违规写入白名单（首次生成用）
白名单：tools/layering_whitelist.json（"文件::模块" 键集合）
"""
import ast
import json
import os
import sys

SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WHITELIST_PATH = os.path.join(SERVER_DIR, "tools", "layering_whitelist.json")

BASE_MODULES = {
    "config", "db", "path_policy", "platform_compat", "security",
    "conn_pool", "secure_store", "trace_core", "roles_db", "model_config",
}

def layer_of(module_name: str):
    """返回层号；模块不在项目内返回 None。module_name 形如 routes.mixin_base / db / engines.common.xxx"""
    parts = module_name.split(".")
    top = parts[0]
    if top in ("routes", "handler_routes"):
        return 3
    if top in ("engines", "tools", "brain", "browser_engine", "tts_stream"):
        return 1
    if top in BASE_MODULES:
        return 0
    # 根目录模块
    if os.path.isfile(os.path.join(SERVER_DIR, top + ".py")):
        return 2
    return None

def iter_project_files():
    for root, dirs, files in os.walk(SERVER_DIR):
        dirs[:] = [d for d in dirs if d not in (
            "__pycache__", ".git", "node_modules", "data", "logs",
            "private", "static", "browser_plugin", "tests")]
        for f in files:
            if f.endswith(".py"):
                yield os.path.join(root, f)

def module_name_of(path: str):
    rel = os.path.relpath(path, SERVER_DIR)
    mod = os.path.splitext(rel)[0].replace(os.sep, ".")
    if mod.endswith(".__init__"):
        mod = mod[: -len(".__init__")]
    return mod

def imports_of(path: str):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            tree = ast.parse(fh.read(), filename=path)
    except SyntaxError:
        return []
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                out.append(a.name)
        elif isinstance(node, ast.ImportFrom):
            if node.level > 0:
                continue  # 相对 import 按同层处理
            if node.module:
                out.append(node.module)
    return out

def main():
    whitelist = set()
    if os.path.isfile(WHITELIST_PATH):
        with open(WHITELIST_PATH, "r", encoding="utf-8") as fh:
            whitelist = set(json.load(fh))

    violations = []
    for path in iter_project_files():
        src_mod = module_name_of(path)
        src_layer = layer_of(src_mod)
        if src_layer is None:
            continue
        for mod in imports_of(path):
            tgt_layer = layer_of(mod)
            if tgt_layer is None or tgt_layer == src_layer:
                continue
            if tgt_layer > src_layer:
                key = f"{src_mod}::{mod}"
                violations.append((src_mod, mod, src_layer, tgt_layer, key))

    if "--update" in sys.argv:
        keys = sorted({v[4] for v in violations})
        with open(WHITELIST_PATH, "w", encoding="utf-8") as fh:
            json.dump(keys, fh, ensure_ascii=False, indent=1)
        print(f"[check_layering] 白名单已更新：{len(keys)} 条存量违规 -> {WHITELIST_PATH}")
        return 0

    new = [v for v in violations if v[4] not in whitelist]
    print(f"[check_layering] 存量(白名单豁免)：{len(violations) - len(new)} 条；新增违规：{len(new)} 条")
    for src, mod, sl, tl, _ in new[:40]:
        print(f"  违规: {src} (L{sl}) -> {mod} (L{tl})  [高层不得 import 低层之上的模块]")
    if new:
        print("如确属存量误报，运行: python tools/check_layering.py --update")
        return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
