# -*- coding: utf-8 -*-
"""生成「自适应清爽版」项目进化树：自包含 SVG HTML，打开即自动铺满整屏，
   无圆形舱裁切、无随机力导爆开、无发芽动画 —— 解决"很乱然后啥也看不到"的问题。
   位置直接采用 json 里已存的径向坐标（确定性布局）。"""
import json, os, sys, html

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "public", "canvas", "进化树", "maps", "project.tree.json")
DST = os.path.join(ROOT, "public", "canvas", "进化树", "项目进化树-清爽版.html")

with open(SRC, encoding="utf-8") as f:
    tree = json.load(f)

# ---- 展平节点 + 父子边 ----
nodes = []
def walk(n):
    nodes.append({
        "id": n["id"], "text": (n.get("text") or "").replace("\\n", "\n"),
        "x": float(n.get("x") or 0), "y": float(n.get("y") or 0),
        "clarity": float(n.get("clarity") or 0), "depth": int(n.get("depth") or 0),
        "icon": n.get("icon") or "•", "status": n.get("status") or "",
        "parent_id": n.get("parent_id"),
    })
    for c in (n.get("children") or []):
        walk(c)
for r in tree.get("roots", []):
    walk(r)

byid = {n["id"]: n for n in nodes}
edges = [(n["parent_id"], n["id"]) for n in nodes if n["parent_id"] in byid]
links = [(l.get("src"), l.get("dst")) for l in tree.get("links", [])
         if l.get("src") in byid and l.get("dst") in byid]

# ---- 包围盒 ----
xs = [n["x"] for n in nodes]; ys = [n["y"] for n in nodes]
PAD = 140
minx, maxx = min(xs) - PAD, max(xs) + PAD
miny, maxy = min(ys) - PAD, max(ys) + PAD
# SVG 的 y 轴向下，世界坐标 y 向上 → 翻转：用 -y
def sx(x): return x
def sy(y): return -y

def style(cl, depth):
    # 浅=淡蓝小而虚，深=亮绿大而实
    t = max(0.0, min(1.0, cl))
    c1, c2 = (58, 110, 165), (88, 214, 141)
    rgb = [int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3)]
    r = (10 + cl * 16) + (8 if depth == 0 else 3 if depth == 1 else 0)
    alpha = 0.30 + t * 0.60
    return f"rgb({rgb[0]},{rgb[1]},{rgb[2]})", r, alpha

svg = []
svg.append(f'<svg id="svg" xmlns="http://www.w3.org/2000/svg" '
           f'viewBox="{minx:.1f} {-maxy:.1f} {maxx-minx:.1f} {maxy-miny:.1f}" '
           f'preserveAspectRatio="xMidYMid meet" width="100%" height="100%">')
# 跨枝关系（虚线，置底）
for s, d in links:
    a, b = byid[s], byid[d]
    svg.append(f'<line x1="{sx(a["x"]):.1f}" y1="{sy(a["y"]):.1f}" x2="{sx(b["x"]):.1f}" '
               f'y2="{sy(b["y"]):.1f}" stroke="#f0b450" stroke-width="1" '
               f'stroke-dasharray="4 5" opacity="0.35"/>')
# 父子边
for s, d in edges:
    a, b = byid[s], byid[d]
    svg.append(f'<line x1="{sx(a["x"]):.1f}" y1="{sy(a["y"]):.1f}" x2="{sx(b["x"]):.1f}" '
               f'y2="{sy(b["y"]):.1f}" stroke="#30465f" stroke-width="1.6" opacity="0.7"/>')
# 节点 + 文字
for n in nodes:
    color, r, alpha = style(n["clarity"], n["depth"])
    cx, cy = sx(n["x"]), sy(n["y"])
    lines = n["text"].split("\n")
    svg.append(f'<g class="nd"><circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" '
               f'fill="{color}" fill-opacity="{alpha:.2f}" stroke="{color}" stroke-width="1.5"/>')
    ty = cy + r + 14
    for i, ln in enumerate(lines):
        anchor_color = "#58d68d" if n["depth"] <= 1 else "#c9d1d9"
        fw = "700" if n["depth"] <= 1 else "400"
        fs = 18 if n["depth"] == 0 else 14 if n["depth"] == 1 else 11
        svg.append(f'<text x="{cx:.1f}" y="{ty+i*15:.1f}" text-anchor="middle" '
                   f'font-size="{fs}" font-weight="{fw}" fill="{anchor_color}">'
                   f'{html.escape((n["icon"]+" " if i==0 else "")+ln)}</text>')
    svg.append('</g>')
svg.append('</svg>')

title = html.escape(tree.get("meta", {}).get("title", "项目进化树"))
doc = """<!DOCTYPE html>
<html lang="zh"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>__TITLE__</title>
<style>
 html,body{margin:0;height:100%;background:#0d1117;overflow:hidden;font-family:"Microsoft YaHei",sans-serif;}
 #svg{display:block;width:100vw;height:100vh;cursor:grab;}
 #svg.drag{cursor:grabbing;}
 #bar{position:fixed;left:12px;top:12px;z-index:9;color:#c9d1d9;font-size:13px;background:rgba(22,27,34,.85);border:1px solid #30363d;border-radius:8px;padding:8px 12px;}
 #bar b{color:#58d68d;} #bar small{color:#8b949e;display:block;margin-top:3px;font-size:11px;}
 #bar button{margin-left:6px;cursor:pointer;background:#21262d;border:1px solid #30363d;color:#c9d1d9;border-radius:5px;padding:2px 8px;font-size:12px;}
</style></head><body>
<div id="bar"><b>__TITLE__</b><small>共 __N__ 节点 · __L__ 条关系 · 滚轮缩放 · 拖动平移 <button id="reset">⟳ 复位</button></small></div>
__SVG__
<script>
(function(){
 var svg=document.getElementById('svg');
 var vb=svg.viewBox.baseVal;
 var home={x:vb.x,y:vb.y,w:vb.width,h:vb.height};
 function clamp(){ if(vb.width<40||vb.height<40){var k=40/Math.min(vb.width,vb.height);vb.width*=k;vb.height*=k;}
   if(vb.width>home.w*8){var k=home.w*8/vb.width;vb.width*=k;vb.height*=k;} }
 svg.addEventListener('wheel',function(e){e.preventDefault();
   var f=e.deltaY<0?0.85:1.18;
   var pt=svg.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;
   var p=pt.matrixTransform(svg.getScreenCTM().inverse());
   vb.x=p.x-(p.x-vb.x)*f; vb.y=p.y-(p.y-vb.y)*f; vb.width*=f; vb.height*=f; clamp(); },{passive:false});
 var drag=null;
 svg.addEventListener('mousedown',function(e){drag={x:e.clientX,y:e.clientY,vx:vb.x,vy:vb.y};svg.classList.add('drag');});
 window.addEventListener('mousemove',function(e){if(!drag)return;
   var ctm=svg.getScreenCTM(); var dx=(e.clientX-drag.x)/ctm.a; var dy=(e.clientY-drag.y)/ctm.d;
   vb.x=drag.vx-dx; vb.y=drag.vy-dy;});
 window.addEventListener('mouseup',function(){drag=null;svg.classList.remove('drag');});
 document.getElementById('reset').onclick=function(){vb.x=home.x;vb.y=home.y;vb.width=home.w;vb.height=home.h;};
 window.addEventListener('resize',function(){/* viewBox 自适应，无需重算 */});
})();
</script>
</body></html>"""
doc = doc.replace("__TITLE__", title).replace("__SVG__", "\n".join(svg))
doc = doc.replace("__N__", str(len(nodes))).replace("__L__", str(len(links)))
with open(DST, "w", encoding="utf-8") as f:
    f.write(doc)
print("OK nodes=%d edges=%d links=%d -> %s" % (len(nodes), len(edges), len(links), DST))
print("bbox x:[%.1f,%.1f] y:[%.1f,%.1f]" % (minx, maxx, miny, maxy))
