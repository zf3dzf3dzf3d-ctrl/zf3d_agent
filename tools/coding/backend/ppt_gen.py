#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ppt_gen - 本地 PPT 生成工具（python-pptx，零API费，生产可用）
用法（工具调用）: {"action":"generate","title":"...","slides":[{"title":"...","bullets":["...","..."]}]}
产物: public/outputs/ppt/<uuid>.pptx，返回可下载 URL。
"""
import os
import json
import uuid
import time

TOOL_NAME = 'ppt_gen'

_OUTPUT_DIR = os.path.join('public', 'outputs', 'ppt')


def _ensure_dir():
    os.makedirs(_OUTPUT_DIR, exist_ok=True)


def generate_ppt(title, slides, save_path=None):
    """生成 pptx。slides: [{title, bullets:[...]}]"""
    from pptx import Presentation
    from pptx.util import Inches, Pt
    from pptx.dml.color import RGBColor
    from pptx.enum.text import PP_ALIGN

    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)

    _THEME_DARK = RGBColor(0x1F, 0x2A, 0x44)
    _THEME_ACCENT = RGBColor(0x2E, 0x86, 0xDE)
    _THEME_TEXT = RGBColor(0x33, 0x33, 0x33)

    def _blank_layout():
        return prs.slide_layouts[6]

    # ---- 封面 ----
    s = prs.slides.add_slide(_blank_layout())
    _full_bg(s, _THEME_DARK)
    _text_box(s, 0.8, 2.6, 11.7, 1.4, title or '未命名演示', 40, bold=True,
              color=RGBColor(0xFF, 0xFF, 0xFF))
    _text_box(s, 0.85, 4.1, 11.7, 0.6, time.strftime('%Y-%m-%d'), 16,
              color=RGBColor(0xBF, 0xCE, 0xE4))

    # ---- 内容页 ----
    for i, sl in enumerate(slides or []):
        s = prs.slides.add_slide(_blank_layout())
        _text_box(s, 0.8, 0.5, 11.7, 1.0, sl.get('title') or ('第%d页' % (i + 1)), 28,
                  bold=True, color=_THEME_DARK)
        _accent_bar(s, 0.85, 1.55, 2.2, 0.06)
        body = sl.get('bullets') or []
        if isinstance(body, str):
            body = [b for b in re_split_lines(body)]
        tb = s.shapes.add_textbox(Inches(0.9), Inches(1.9), Inches(11.5), Inches(5.0))
        tf = tb.text_frame
        tf.word_wrap = True
        for j, b in enumerate(body[:12]):
            p = tf.paragraphs[0] if j == 0 else tf.add_paragraph()
            p.text = '• ' + str(b)
            p.font.size = Pt(20)
            p.font.color.rgb = _THEME_TEXT
            p.space_after = Pt(10)

    # ---- 结尾页 ----
    s = prs.slides.add_slide(_blank_layout())
    _full_bg(s, _THEME_DARK)
    _text_box(s, 0.8, 3.0, 11.7, 1.2, '谢谢观看', 36, bold=True,
              color=RGBColor(0xFF, 0xFF, 0xFF), align=PP_ALIGN.CENTER)

    _ensure_dir()
    if not save_path:
        save_path = os.path.join(_OUTPUT_DIR, 'ppt_%s_%s.pptx' % (
            time.strftime('%Y%m%d_%H%M%S'), uuid.uuid4().hex[:6]))
    prs.save(save_path)
    return save_path


def re_split_lines(text):
    return [ln.strip() for ln in str(text).replace('\r', '').split('\n') if ln.strip()]


def _full_bg(slide, color):
    from pptx.util import Inches
    from pptx.enum.shapes import MSO_SHAPE
    shp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0),
                                 Inches(13.333), Inches(7.5))
    shp.fill.solid()
    shp.fill.fore_color.rgb = color
    shp.line.fill.background()
    slide.shapes._spTree.append(shp._element)


def _accent_bar(slide, x, y, w, h):
    from pptx.util import Inches
    from pptx.dml.color import RGBColor
    from pptx.enum.shapes import MSO_SHAPE
    shp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y),
                                 Inches(w), Inches(h))
    shp.fill.solid()
    shp.fill.fore_color.rgb = RGBColor(0x2E, 0x86, 0xDE)
    shp.line.fill.background()


def _text_box(slide, x, y, w, h, text, size, bold=False, color=None, align=None):
    from pptx.util import Inches, Pt
    from pptx.dml.color import RGBColor
    from pptx.enum.text import PP_ALIGN
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    p.text = str(text or '')
    p.font.size = Pt(size)
    p.font.bold = bold
    if color is not None:
        p.font.color.rgb = color
    if align is not None:
        p.alignment = align
    return tb


def handle(body, ctx):
    action = (body or {}).get('action', 'generate')
    if action == 'status':
        try:
            import pptx
            ver = pptx.__version__
        except Exception:
            ver = None
        ctx.send_json({'ok': True, 'data': {'tool': 'ppt_gen', 'python_pptx': ver,
                                            'ready': bool(ver)}})
        return
    title = (body or {}).get('title', '') or '未命名演示'
    slides = (body or {}).get('slides') or []
    if not slides:
        ctx.send_json({'ok': False, 'data': {'error': 'slides 不能为空，格式: [{"title":"页标题","bullets":["要点1","要点2"]}]'}})
        return
    try:
        path = generate_ppt(title, slides)
        url = '/' + path.replace('\\', '/').split('/public/')[-1] if '/public/' in path.replace('\\', '/') else '/outputs/ppt/' + os.path.basename(path)
        ctx.send_json({'ok': True, 'data': {
            'tool': 'ppt_gen', 'file': os.path.basename(path), 'path': path, 'url': url,
            'slides_count': len(slides), 'bytes': os.path.getsize(path)}})
    except Exception as e:
        ctx.send_json({'ok': False, 'data': {'error': 'PPT 生成失败: %s' % e}})


if __name__ == '__main__':
    class _T:
        def send_json(self, o, *a, **k):
            print(json.dumps(o, ensure_ascii=False, indent=2))
    handle({'action': 'generate', 'title': '测试PPT', 'slides': [
        {'title': '背景', 'bullets': ['要点一', '要点二']},
        {'title': '方案', 'bullets': ['方案A', '方案B', '方案C']},
    ]}, _T())
