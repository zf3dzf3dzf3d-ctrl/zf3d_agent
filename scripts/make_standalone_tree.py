# -*- coding: utf-8 -*-
"""把 viewer.html + project.tree.json 合成一个完全自包含的 HTML。
原理：viewer 的 init() 有兜底 window.__TREE__，若已设置则直接 useTree 渲染，
不再 fetch（因此双击/ file:// 也能离线打开）。只需在 </head> 前注入数据脚本。"""
import json, io, os, re

BASE = r"F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.6.0\public\canvas\进化树"
viewer_path = os.path.join(BASE, "viewer.html")
data_path = os.path.join(BASE, "maps", "project.tree.json")
out_path = os.path.join(BASE, "项目进化树-独立版.html")

with io.open(data_path, "r", encoding="utf-8") as f:
    tree = json.load(f)

# 紧凑 JSON
tree_js = json.dumps(tree, ensure_ascii=False, separators=(",", ":"))

with io.open(viewer_path, "r", encoding="utf-8") as f:
    html = f.read()

inject = "<script>window.__TREE__=%s;</script>\n</head>" % tree_js
if "</head>" not in html:
    raise SystemExit("viewer.html 未找到 </head>")
# 只替换第一个 </head>
html = html.replace("</head>", inject, 1)

with io.open(out_path, "w", encoding="utf-8") as f:
    f.write(html)

print("NODES:", len(tree.get("nodes", [])))
print("LINKS:", len(tree.get("links", [])))
print("OUT:", out_path)
print("SIZE:", os.path.getsize(out_path))
