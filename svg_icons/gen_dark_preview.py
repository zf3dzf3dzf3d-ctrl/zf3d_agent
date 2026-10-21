# -*- coding: utf-8 -*-
"""生成暗夜版配色图标预览页 preview_dark.html（仅预览，不改线上 icons.js）
从 gen_color_icons.py 提取图标定义，做暗色适配后与亮色版并排对比展示。
"""
import ast, io, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "svg_icons", "gen_color_icons.py")
OUT = os.path.join(ROOT, "svg_icons", "preview_dark.html")

src = io.open(SRC, encoding="utf-8").read()
tree = ast.parse(src)
grads = icons = None
for node in tree.body:
    if isinstance(node, ast.Assign):
        for t in node.targets:
            if getattr(t, "id", "") == "GRADS":
                grads = ast.literal_eval(node.value)
            if getattr(t, "id", "") == "ICONS":
                icons = ast.literal_eval(node.value)
assert grads and icons, "未找到 GRADS/ICONS 定义"

# ---- 暗夜版渐变：亮端更亮、暗端更饱和，保证在深色背景上跳出来 ----
DARK_GRAD_MAP = {
    "gBlue":   ("#A5D8FF", "#1E88E5"),
    "gGreen":  ("#A8F0B4", "#2E9E55"),
    "gOrange": ("#FFD59E", "#F57C00"),
    "gPurple": ("#D9BCFF", "#8558EE"),
    "gRed":    ("#FFB3B3", "#E8494A"),
    "gTeal":   ("#8FF0E2", "#0FA396"),
    "gPink":   ("#FFBDD6", "#EE4E8C"),
    "gGold":   ("#FFE9A8", "#F5AE12"),
    "gIndigo": ("#B4C0FF", "#4A63F0"),
    "gGray":   ("#D5DDE2", "#6E828E"),
}
def dark_grads():
    out = []
    for gid, (c1, c2) in DARK_GRAD_MAP.items():
        out.append('<linearGradient id="%s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="%s"/><stop offset="1" stop-color="%s"/></linearGradient>' % (gid, c1, c2))
    return "\n".join(out)

# ---- 暗色背景下会"沉底"的深色元素换成更亮的等价色 ----
BODY_DARK_SUBS = [
    ('#546E7A', '#78909C'),   # 剪贴板夹子
    ('#1A237E', '#0B1026'),   # 深藏青细节（保留深，靠亮渐变衬托）
    ('#5D4037', '#8D6E63'),   # 铃铛顶
    ('#1565C0', '#90CAF9'),   # 时钟指针改亮
]

def build_svg(body, dark=False, suffix=""):
    used = list(dict.fromkeys(re.findall(r'url\(#(g\w+)\)', body)))
    if dark:
        g = dark_grads()
        for a, b in BODY_DARK_SUBS:
            body = body.replace(a, b)
    else:
        g = grads
    defs = ""
    if used:
        parts = []
        for gid in used:
            m = re.search(r'<linearGradient id="%s".*?</linearGradient>' % gid, g, re.S)
            if m:
                s = m.group(0)
                if suffix:
                    s = s.replace('id="%s"' % gid, 'id="%s%s"' % (gid, suffix))
                parts.append(s)
        defs = "<defs>%s</defs>" % "".join(parts)
    body2 = body
    if suffix:
        body2 = re.sub(r'url\(#(g\w+)\)', r'url(#\1%s)' % suffix, body)
    return '<svg viewBox="0 0 24 24" width="40" height="40">%s%s</svg>' % (defs, body2)

rows = []
for name, emoji, _grad, body in icons:
    if not emoji:
        continue
    rows.append(
        '<div class="card"><div class="ic">%s</div><div class="ic">%s</div>'
        '<div class="nm">%s<br><span class="em">%s</span></div></div>'
        % (build_svg(body, dark=False), build_svg(body, dark=True, suffix="D"), name, emoji)
    )

html = u"""<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8">
<title>图标暗夜版配色对比</title>
<style>
 body{margin:0;font-family:"Segoe UI",system-ui,sans-serif;background:#0d1117;color:#e6edf3}
 header{padding:20px 28px;background:#161b22;border-bottom:1px solid #30363d}
 h1{margin:0 0 6px;font-size:20px} p{margin:0;color:#8b949e;font-size:13px}
 .grid{display:flex;flex-wrap:wrap;gap:14px;padding:24px 28px}
 .card{display:flex;align-items:center;gap:12px;background:#161b22;border:1px solid #30363d;border-radius:10px;padding:12px 16px}
 .ic{width:44px;height:44px;display:flex;align-items:center;justify-content:center}
 .nm{font-size:12px;color:#8b949e;line-height:1.5;min-width:86px}
 .em{font-size:16px}
 .legend{padding:0 28px 18px;color:#8b949e;font-size:13px}
 .legend b{color:#e6edf3}
</style></head><body>
<header><h1>图标配色对比：亮色版（当前线上） vs 暗夜版（新配色）</h1>
<p>左 = 当前线上配色，右 = 暗夜版配色（亮端提亮、暗端加深饱和、深色细节微调）</p></header>
<div class="legend">每张卡片：<b>左</b>=亮色版 &nbsp;|&nbsp; <b>右</b>=暗夜版</div>
<div class="grid">%s</div>
</body></html>""" % "".join(rows)

io.open(OUT, "w", encoding="utf-8").write(html)
print("OK", OUT, len(html), "bytes,", len(rows), "icons")
