# -*- coding: utf-8 -*-
"""JS 改动收尾校验脚本：改了 public/js 下 JS 后必须跑一遍，不过不许 task_complete。
用法: ..\..\python\python.exe check_js_release.py <js文件名1> <js文件名2> ...
检查项:
 1) server/public/js 同名副本与 public/js 哈希一致
 2) 三份入口(public/index.html, server/public/index.html, public/_clean_index/index.html.clean)
    均含该 js 且缓存号 ?v= 与 public/index.html 中该文件的实际版本一致
"""
import sys, os, hashlib, re

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # 项目根（tools→server→根）
# 单副本白名单：历史即单副本文件，豁免双副本校验（见项目记录《专注模式UI调整记录》）
SINGLE_COPY_WHITELIST = {
    "app-focus-mode.js",
}
ENTRIES = [
    os.path.join(ROOT, "public", "index.html"),
    os.path.join(ROOT, "server", "public", "index.html"),
    os.path.join(ROOT, "public", "_clean_index", "index.html.clean"),
]
PUB = os.path.join(ROOT, "public", "js")
SRV = os.path.join(ROOT, "server", "public", "js")

def md5(p):
    return hashlib.md5(open(p, "rb").read()).hexdigest()

ok = True
for name in sys.argv[1:]:
    pub = os.path.join(PUB, name)
    srv = os.path.join(SRV, name)
    if not os.path.exists(pub):
        print(f"[FAIL] public/js/{name} 不存在"); ok = False; continue
    if name in SINGLE_COPY_WHITELIST:
        print(f"[SKIP] {name} 在单副本白名单，豁免双副本校验")
    elif os.path.exists(srv):
        if md5(pub) != md5(srv):
            print(f"[FAIL] {name} 双副本哈希不一致，需同步 server/public/js"); ok = False
        else:
            print(f"[OK] {name} 双副本一致")
    else:
        print(f"[FAIL] 缺 server/public/js/{name} 副本"); ok = False
    m = re.search(re.escape(name) + r"\?v=(\d+)", open(pub, "rb").read().decode("utf-8", "ignore") if False else open(ENTRIES[0], encoding="utf-8", errors="ignore").read())
    ver = m.group(1) if m else None
    if not ver:
        print(f"[WARN] {name} 在主入口无 ?v= 缓存号（可能本就不带）"); continue
    for e in ENTRIES:
        t = open(e, encoding="utf-8", errors="ignore").read()
        if f"{name}?v={ver}" in t:
            print(f"[OK] {os.path.relpath(e, ROOT)} 含 {name}?v={ver}")
        else:
            print(f"[FAIL] {os.path.relpath(e, ROOT)} 未含 {name}?v={ver}（缓存号未同步）"); ok = False

print("== 全部通过 ==" if ok else "== 存在失败项，禁止交付 ==")
sys.exit(0 if ok else 1)
