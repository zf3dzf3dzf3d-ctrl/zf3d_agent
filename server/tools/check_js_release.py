# -*- coding: utf-8 -*-
"""JS 改动收尾校验脚本：改了 public/js 下 JS 后必须跑一遍，不过不许 task_complete。
用法: ..\..\python\python.exe check_js_release.py <js文件名1> <js文件名2> ...
检查项（2026-11-22 双副本消灭收口后·单副本口径）:
 1) public/js/<name> 存在
 2) public/index.html 含该 js 且缓存号 ?v= 与引用一致
"""
import sys, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # 项目根（tools→server→根）
MAIN_ENTRY = os.path.join(ROOT, "public", "index.html")
PUB = os.path.join(ROOT, "public", "js")

ok = True
for name in sys.argv[1:]:
    pub = os.path.join(PUB, name)
    if not os.path.exists(pub):
        print(f"[FAIL] public/js/{name} 不存在"); ok = False; continue
    print(f"[OK] public/js/{name} 存在")
    m = re.search(re.escape(name) + r"\?v=(\d+)", open(MAIN_ENTRY, encoding="utf-8", errors="ignore").read())
    ver = m.group(1) if m else None
    if not ver:
        print(f"[WARN] {name} 在主入口无 ?v= 缓存号（可能本就不带）"); continue
    t = open(MAIN_ENTRY, encoding="utf-8", errors="ignore").read()
    if f"{name}?v={ver}" in t:
        print(f"[OK] public/index.html 含 {name}?v={ver}")
    else:
        print(f"[FAIL] public/index.html 未含 {name}?v={ver}（缓存号未 bump）"); ok = False

print("== 全部通过 ==" if ok else "== 存在失败项，禁止交付 ==")
sys.exit(0 if ok else 1)
