# -*- coding: utf-8 -*-
"""Markdown → HTML演示(.pres.json) 导入工具

用法:
    python tools/import_md.py 文件.md [输出名]

Markdown 约定（对大模型最友好的写法）:
    ---            分页分隔符
    # 标题          第一页 → 封面页（下一行为副标题可选）
    ## 标题        每页标题
    - 文本          列表项 → bullets
    > 文本         引用/说明 → text 文本页段落
    ![说明](路径)   图片（自动判断本地文件转 data-uri，url 直接用）
    纯文本          若该页只有一段文字 → text 页；与列表/图片混合时列表优先
"""
import sys, os, json, base64, re, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SLIDES = os.path.join(ROOT, "slides")
INDEX = os.path.join(ROOT, "index.json")
IMG_EXT = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp")

def img_to_src(path_or_url, base_dir):
    if path_or_url.startswith(("http://", "https://", "data:")):
        return path_or_url
    p = path_or_url if os.path.isabs(path_or_url) else os.path.join(base_dir, path_or_url)
    if os.path.exists(p):
        ext = os.path.splitext(p)[1].lstrip(".").lower()
        mime = "jpeg" if ext in ("jpg", "jpeg") else ext
        with open(p, "rb") as f:
            return "data:image/%s;base64,%s" % (mime, base64.b64encode(f.read()).decode())
    return None

def parse_md(md_text, base_dir):
    # 去掉代码块里的 --- 误伤：简单跳过 ``` 围栏
    pages, cur, in_fence = [], [], False
    for line in md_text.splitlines():
        if line.strip().startswith("```"):
            in_fence = not in_fence
        if not in_fence and line.strip() == "---":
            pages.append(cur); cur = []
        else:
            cur.append(line)
    pages.append(cur)

    slides = []
    for chunk in pages:
        lines = [l for l in chunk]
        # 提取各要素
        h1 = h2 = None; bullets = []; text = []; images = []
        for l in lines:
            s = l.strip()
            if not s: continue
            if s.startswith("# ") and h1 is None and not bullets:
                h1 = s[2:].strip(); continue
            if s.startswith("## "):
                h2 = s[3:].strip(); continue
            m = re.match(r"^[-*+]\s+(.*)", s)
            if m:
                bullets.append(m.group(1).strip()); continue
            m = re.match(r"^!\[([^\]]*)\]\(([^)]+)\)", s)
            if m:
                src = img_to_src(m.group(2), base_dir)
                if src: images.append(src)
                continue
            if s.startswith(">"):
                text.append(s.lstrip("> ").strip()); continue
            text.append(s)
        body = "\n".join(text).strip()

        if not (h1 or h2 or bullets or body or images):
            continue
        if not slides and h1:  # 第一页 H1 → 封面
            slides.append({"type": "cover", "title": h1, "subtitle": body or h2 or ""})
            continue
        title = h2 or h1 or ""
        if images:
            els = []
            for i, src in enumerate(images):
                els.append({"type": "image", "src": src,
                            "x": 100 + (i % 2) * 560, "y": 120 + (i // 2) * 300,
                            "w": 480, "h": 280, "fit": "contain"})
            if bullets:
                els.append({"type": "text", "x": 60, "y": 560, "w": 1160, "h": 130,
                            "text": " · ".join(bullets), "size": 22})
            slides.append({"type": "scene", "title": title, "elements": els})
        elif bullets:
            slide = {"title": title, "bullets": bullets}
            if body and not bullets:
                slide["text"] = body
            slides.append(slide)
        else:
            slides.append({"title": title, "text": body})
    return slides

def main():
    args = sys.argv[1:]
    if not args:
        print("用法: python tools/import_md.py 文件.md [输出名]"); return
    md_path = os.path.abspath(args[0])
    name = args[1] if len(args) > 1 else re.sub(r"\W+", "_", os.path.splitext(os.path.basename(md_path))[0]).lower()
    with open(md_path, "r", encoding="utf-8-sig") as f:
        md = f.read()
    slides = parse_md(md, os.path.dirname(md_path))
    if not slides:
        print("未解析出任何页"); return
    # 标题
    title = "未命名演示"
    if slides and slides[0].get("type") == "cover":
        title = slides[0]["title"]
    out = {"meta": {"title": title, "author": "md导入",
                    "created": datetime.date.today().isoformat()},
           "slides": slides}
    os.makedirs(SLIDES, exist_ok=True)
    out_path = os.path.join(SLIDES, name + ".pres.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    idx = []
    if os.path.exists(INDEX):
        with open(INDEX, "r", encoding="utf-8-sig") as f:
            try: idx = json.load(f)
            except: idx = []
    if not any(e.get("file") == name for e in idx):
        idx.append({"title": title, "file": name})
    with open(INDEX, "w", encoding="utf-8") as f:
        json.dump(idx, f, ensure_ascii=False, indent=2)
    print("OK %d 页 -> %s (index.json 已更新)" % (len(slides), out_path))

if __name__ == "__main__":
    main()
