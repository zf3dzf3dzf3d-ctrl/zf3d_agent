# -*- coding: utf-8 -*-
"""
.pptx -> HTML 演示稿(.pres.json) 导入工具
用法:
  python import_pptx.py 路径/文件.pptx [输出名]
输出: 演示/slides/输出名.pres.json （并自动追加到 index.json）
说明: 提取每页文本和图片；动画/SmartArt 等复杂效果不迁移。
"""
import sys, os, json, re, base64, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..'))
SLIDES_DIR = os.path.join(ROOT, 'slides')
INDEX_FILE = os.path.join(ROOT, 'index.json')

EMU_PER_PX = 9525.0  # 1px = 9525 EMU (96dpi)
CANVAS_W, CANVAS_H = 1280, 720


def emu2px(v):
    try:
        return int(round(int(v) / EMU_PER_PX))
    except Exception:
        return 0


def clean(s):
    return re.sub(r'\s+', ' ', s).strip() if s else ''


def extract_text(shape):
    """递归提取组合形状里的文字"""
    texts = []
    if shape.shape_type == 6:  # GROUP
        for sub in shape.shapes:
            texts += extract_text(sub)
        return texts
    if shape.has_text_frame:
        for p in shape.text_frame.paragraphs:
            t = clean(''.join(r.text for r in p.runs) or p.text)
            if t:
                texts.append(t)
    return texts


def extract_image(shape):
    if shape.shape_type == 13:  # PICTURE
        try:
            img = shape.image
            b64 = base64.b64encode(img.blob).decode()
            return 'data:%s;base64,%s' % (img.content_type, b64)
        except Exception:
            return None
    return None


def convert(pptx_path, out_name=None):
    from pptx import Presentation
    from pptx.util import Emu

    prs = Presentation(pptx_path)
    if not out_name:
        base = os.path.splitext(os.path.basename(pptx_path))[0]
        out_name = re.sub(r'[^\w\-]', '_', base).lower() or 'imported'
    out_file = os.path.join(SLIDES_DIR, out_name + '.pres.json')

    # 幻灯片原始尺寸(EMU) -> 画布比例
    sw = prs.slide_width or Emu(9144000)
    sh = prs.slide_height or Emu(5143500)
    sx = CANVAS_W / float(sw)
    sy = CANVAS_H / float(sh)

    slides = []
    for idx, slide in enumerate(prs.slides, 1):
        texts, pics = [], []
        for shape in slide.shapes:
            ts = extract_text(shape)
            src = extract_image(shape)
            if src:
                x = emu2px(shape.left * sx) if shape.left is not None else 0
                y = emu2px(shape.top * sy) if shape.top is not None else 0
                w = emu2px(shape.width * sx) if shape.width is not None else 600
                h = emu2px(shape.height * sy) if shape.height is not None else 400
                pics.append({'type': 'image', 'x': x, 'y': y, 'w': max(w, 40),
                             'h': max(h, 40), 'src': src, 'fit': 'contain'})
            texts += ts

        # 第一页且有标题 -> 封面
        if idx == 1 and len(texts) <= 3:
            title = texts[0] if texts else '导入的演示'
            sub = texts[1] if len(texts) > 1 else ''
            slides.append({'type': 'cover', 'title': title, 'subtitle': sub})
            continue

        # 少量文字 -> 列表页；大量 -> 自由画布页(文字放不了就用文本块)
        if len(texts) <= 8 and not pics:
            # 第一条若是短标题样式则作为页标题
            if len(texts) > 2 and len(texts[0]) <= 30:
                slides.append({'title': texts[0], 'bullets': texts[1:]})
            else:
                slides.append({'title': '第 %d 页' % idx, 'bullets': texts})
        elif pics and len(texts) <= 4:
            els = list(pics)
            ty = 20
            for t in texts:
                els.append({'type': 'text', 'x': 40, 'y': ty, 'w': CANVAS_W - 80,
                            'size': 22, 'bold': 700, 'color': '#222', 'text': t})
                ty += 50
            slides.append({'type': 'scene', 'title': texts[0] if texts else '第 %d 页' % idx,
                           'bg': '#ffffff', 'elements': els})
        else:
            if len(texts) > 2 and len(texts[0]) <= 30:
                slides.append({'title': texts[0], 'bullets': texts[1:]})
            else:
                slides.append({'title': '第 %d 页' % idx, 'bullets': texts or ['(本页无可提取文本)']})

    title = os.path.splitext(os.path.basename(pptx_path))[0]
    data = {'meta': {'title': title, 'author': 'pptx 导入', 'created': str(datetime.date.today())},
            'slides': slides}
    with open(out_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # 更新 index.json
    idx_data = []
    if os.path.isfile(INDEX_FILE):
        try:
            with open(INDEX_FILE, 'r', encoding='utf-8-sig') as f:
                idx_data = json.load(f)
        except Exception:
            idx_data = []
    if not any(e.get('file') == out_name for e in idx_data):
        idx_data.append({'title': title, 'file': out_name})
    with open(INDEX_FILE, 'w', encoding='utf-8') as f:
        json.dump(idx_data, f, ensure_ascii=False, indent=2)

    print('OK: %s (%d 页) -> %s' % (pptx_path, len(slides), out_file))
    return out_file


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    convert(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
