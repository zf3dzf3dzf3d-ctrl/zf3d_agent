# -*- coding: utf-8 -*-
"""生成「朱峰智能体无限 5.7.0」项目的万物进化树数据 (viewer 用 JSON)。
结构：嵌套 roots 树 + links 跨枝关系网。坐标用放射状布局。
成熟度 status: seed/sprout/grow/branch/bloom；clarity: 0~1。
"""
import json, math, os

_id = [0]
def nid():
    _id[0] += 1
    return _id[0]

def node(text, clarity, status, icon="", kind="capability"):
    return {
        "id": nid(), "parent_id": None, "text": text, "path": text,
        "depth": 0, "clarity": clarity, "status": status,
        "icon": icon, "kind": kind, "x": 0.0, "y": 0.0, "children": [],
    }

# ---------- 1. 构建能力树（基于真实模块） ----------
root = node("朱峰智能体无限\n5.7.0", 0.95, "bloom", "🌳")

branches = [
    # (分支名, icon, clarity, status, [(叶名, clarity, status), ...])
    ("服务端核心", "⚙️", 0.9, "bloom", [
        ("HTTP 服务 server.py", 0.95, "bloom"),
        ("路由分发 routes", 0.85, "branch"),
        ("引擎集群 engines", 0.8, "branch"),
        ("热更新 hot_reload", 0.7, "grow"),
    ]),
    ("对话与模式", "💬", 0.85, "bloom", [
        ("对话池 chat_pool", 0.9, "bloom"),
        ("多模式 modes", 0.8, "branch"),
        ("蜂群调度 swarm", 0.65, "grow"),
        ("流水线 flow_engine", 0.6, "grow"),
    ]),
    ("工具体系", "🛠️", 0.9, "bloom", [
        ("极简工具集", 0.95, "bloom"),
        ("编程工具集", 0.9, "bloom"),
        ("写作工具集", 0.85, "branch"),
        ("自定义注册 register_tool", 0.7, "grow"),
    ]),
    ("记忆系统", "🧠", 0.8, "branch", [
        ("长期记忆", 0.85, "branch"),
        ("语义检索 semantic", 0.6, "grow"),
        ("表格记忆 table", 0.75, "grow"),
        ("项目记录 project_record", 0.8, "branch"),
    ]),
    ("浏览器自动化", "🌐", 0.8, "branch", [
        ("Playwright 引擎", 0.85, "branch"),
        ("浏览器插件", 0.7, "grow"),
        ("登录态持久化", 0.75, "grow"),
        ("站点记忆", 0.5, "sprout"),
    ]),
    ("多模态生成", "🎨", 0.75, "branch", [
        ("文生图 image_gen", 0.85, "branch"),
        ("文生视频 video_gen", 0.7, "grow"),
        ("语音合成 TTS", 0.8, "branch"),
        ("视频剪辑 video_edit", 0.65, "grow"),
    ]),
    ("画布可视化", "🗺️", 0.7, "branch", [
        ("万物进化树", 0.75, "grow"),
        ("思维导图", 0.7, "grow"),
        ("白板/表格/文档", 0.65, "grow"),
        ("2D 引擎 engine2d", 0.55, "sprout"),
    ]),
    ("模型与计费", "💳", 0.7, "branch", [
        ("多渠道配置", 0.8, "branch"),
        ("计费 zf_billing", 0.65, "grow"),
        ("代理网关 proxy", 0.6, "grow"),
        ("模型同步", 0.7, "grow"),
    ]),
    ("安全与守护", "🛡️", 0.7, "branch", [
        ("门禁 chat_gate", 0.65, "grow"),
        ("看门狗 watchdog", 0.7, "grow"),
        ("健康中心 health", 0.6, "grow"),
        ("网络守护", 0.55, "sprout"),
    ]),
    ("客户端形态", "📱", 0.6, "grow", [
        ("桌面 Webview", 0.75, "grow"),
        ("系统托盘 tray", 0.7, "grow"),
        ("手机版 Android", 0.45, "sprout"),
    ]),
]

for bname, bicon, bclarity, bstatus, leaves in branches:
    b = node(bname, bclarity, bstatus, bicon)
    b["path"] = f"{root['text']}/{bname}"
    for lname, lclarity, lstatus in leaves:
        l = node(lname, lclarity, lstatus, "•")
        l["path"] = f"{root['text']}/{bname}/{lname}"
        b["children"].append(l)
    root["children"].append(b)

# 收集所有节点（用于建 links 与布局）
all_nodes = []
def walk(n, parent, depth):
    n["parent_id"] = parent["id"] if parent else None
    n["depth"] = depth
    all_nodes.append(n)
    for c in n["children"]:
        walk(c, n, depth + 1)
walk(root, None, 0)

# ---------- 2. 放射状布局 ----------
root["x"], root["y"] = 0.0, 0.0
LEVEL_R = {1: 260.0, 2: 470.0}   # 各层半径
branches_l = [n for n in all_nodes if n["depth"] == 1]
nb = len(branches_l)
for i, b in enumerate(branches_l):
    ang = 2 * math.pi * i / nb - math.pi / 2
    R = LEVEL_R[1]
    b["x"] = round(R * math.cos(ang), 2)
    b["y"] = round(R * math.sin(ang), 2)
    kids = b["children"]
    n_ = len(kids)
    spread = math.pi * 0.62          # 该分支子节点张角
    for j, k in enumerate(kids):
        a2 = ang - spread / 2 + spread * (j / max(n_ - 1, 1) if n_ > 1 else 0.5)
        r2 = LEVEL_R[2]
        k["x"] = round(r2 * math.cos(a2), 2)
        k["y"] = round(r2 * math.sin(a2), 2)

# 给每个分支一个稳定短 id 映射 (按名字)
by_name = {}
for n in all_nodes:
    by_name.setdefault(n["text"], n["id"])

# ---------- 3. 跨枝关系 links（默认隐，按需点亮） ----------
def L(src, dst, kind="depend"):
    if src in by_name and dst in by_name:
        return {"src": by_name[src], "dst": by_name[dst], "kind": kind}
    return None

link_defs = [
    ("浏览器自动化", "工具体系", "depend"),
    ("多模态生成", "模型与计费", "depend"),
    ("对话与模式", "记忆系统", "depend"),
    ("对话与模式", "工具体系", "depend"),
    ("服务端核心", "模型与计费", "depend"),
    ("安全与守护", "服务端核心", "depend"),
    ("客户端形态", "服务端核心", "depend"),
    ("画布可视化", "记忆系统", "depend"),
    ("语音合成 TTS", "多模态生成", "partof"),
    ("蜂群调度 swarm", "流水线 flow_engine", "depend"),
    ("Playwright 引擎", "浏览器插件", "depend"),
]
links = []
lid = 100
for src, dst, kind in link_defs:
    lk = L(src, dst, kind)
    if lk:
        lk["id"] = lid
        lid += 1
        links.append(lk)

data = {
    "meta": {
        "title": "朱峰智能体无限 5.7.0 · 项目进化树",
        "subject_type": "project",
        "subject_id": "proj_1792075652565",
        "created": "2026-10-19",
    },
    "roots": [root],
    "links": links,
}

out_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "public", "canvas", "进化树", "maps")
os.makedirs(out_dir, exist_ok=True)
out_path = os.path.join(out_dir, "project.tree.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print("NODES:", len(all_nodes))
print("LINKS:", len(links))
print("OUT:", out_path)
