# -*- coding: utf-8 -*-
"""生成头像预览页 svg_icons/preview_avatars.html（当前 57 个角色头像的 SVG 实际效果）"""
import io, json, re, os

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(root)

src = io.open("public/js/icons.js", encoding="utf-8").read()
i = src.index("var MAP =")
line_end = src.index("\n", i)
data = json.loads(src[i + len("var MAP ="):line_end].strip().rstrip(";"))

rsrc = io.open("public/js/chatbox-roles.js", encoding="utf-8").read()
a = rsrc.index("AVATAR_LIST")
b = rsrc.index(".split", a)
avatars = [e for p in re.findall(r"'([^']*)'", rsrc[a:b]) for e in p.split() if e]

norm = lambda e: e.replace("\ufe0f", "")
nmap = {norm(k): k for k in data}
cells = "".join(
    '<div class="c">%s<div class="l">%s</div></div>' % (data[nmap.get(norm(e), e)], e)
    for e in avatars
)
html = (
    '<!doctype html><meta charset="utf-8"><title>头像清单预览</title>'
    '<style>body{background:#1e2230;color:#eee;font-family:Segoe UI Emoji,system-ui;'
    'padding:24px}#g{display:grid;grid-template-columns:repeat(auto-fill,'
    'minmax(90px,1fr));gap:10px}.c{background:#2a2f3e;border-radius:10px;'
    'padding:12px 6px;text-align:center;font-size:34px}.l{font-size:11px;'
    'color:#9aa;margin-top:6px}</style>'
    '<h2>当前 %d 个角色头像（SVG 实际渲染效果）</h2><div id="g">' % len(avatars)
    + cells + "</div>"
)
out = os.path.join(root, "svg_icons", "preview_avatars.html")
io.open(out, "w", encoding="utf-8").write(html)
print("written:", out, len(avatars))
