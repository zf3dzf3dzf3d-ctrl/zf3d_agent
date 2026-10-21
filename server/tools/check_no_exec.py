# -*- coding: utf-8 -*-
"""
check_no_exec.py — 禁止 exec()/eval() 拼接代码护栏（AST 静态分析）

扫描 server 下（豁免 tests/data/logs/private）所有 .py，
对 Call(func=Name('exec'|'eval')|Attribute(attr=...)) 报告。

用法：
  python tools/check_no_exec.py            # 非白名单违规退出码 1
  python tools/check_no_exec.py --update   # 存量写入白名单
白名单：tools/no_exec_whitelist.json（"文件:行号" 键集合，行号漂移视为该文件整体豁免条目）。

注意：白名单按「文件+行号」记录，存量文件再新增 exec 会在新行号上报。
"""
import ast
import json
import os
import sys

SERVER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WHITELIST_PATH = os.path.join(SERVER_DIR, "tools", "no_exec_whitelist.json")
TARGETS = {"exec", "eval"}

def iter_project_files():
    for root, dirs, files in os.walk(SERVER_DIR):
        dirs[:] = [d for d in dirs if d not in (
            "__pycache__", ".git", "node_modules", "data", "logs",
            "private", "static", "browser_plugin")]
        for f in files:
            if f.endswith(".py") and f != os.path.basename(__file__):
                yield os.path.join(root, f)

def find_calls(path: str):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            tree = ast.parse(fh.read(), filename=path)
    except SyntaxError:
        return []
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            fn = node.func
            name = fn.id if isinstance(fn, ast.Name) else (
                fn.attr if isinstance(fn, ast.Attribute) else None)
            if name in TARGETS:
                out.append(node.lineno)
    return out

def main():
    whitelist = set()
    if os.path.isfile(WHITELIST_PATH):
        with open(WHITELIST_PATH, "r", encoding="utf-8") as fh:
            whitelist = set(json.load(fh))

    violations = []
    for path in iter_project_files():
        rel = os.path.relpath(path, SERVER_DIR).replace(os.sep, "/")
        for ln in find_calls(path):
            key = f"{rel}:{ln}"
            violations.append((rel, ln, key))

    if "--update" in sys.argv:
        keys = sorted({v[2] for v in violations})
        with open(WHITELIST_PATH, "w", encoding="utf-8") as fh:
            json.dump(keys, fh, ensure_ascii=False, indent=1)
        print(f"[check_no_exec] 白名单已更新：{len(keys)} 条存量 -> {WHITELIST_PATH}")
        return 0

    new = [v for v in violations if v[2] not in whitelist]
    print(f"[check_no_exec] 存量(白名单豁免)：{len(violations) - len(new)} 条；新增违规：{len(new)} 条")
    for rel, ln, _ in new[:40]:
        print(f"  违规: {rel}:{ln} 出现 exec()/eval() 调用")
    if new:
        print("如确属存量误报，运行: python tools/check_no_exec.py --update")
        return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
