#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""vision_studio - 视觉精修工具（纯 Pillow 实现，无 numpy、无外部引擎）

架构：直接在本体工具进程内用 Pillow 处理像素，不依赖任何外部 HTTP 服务。
会话状态（原图/当前图/背景色/容差）保存在模块级变量中。

动作(action)：
  open           开图+自动识别去背景   {image_path}
  set_background 调整背景色/容差/羽化   {r,g,b, tolerance?, feather?}
  brush          画笔擦除/恢复           {mode: erase|restore, x, y, radius?}
  crop           裁剪                    {x,y,w,h}
  resize         缩放                    {width?, height?}
  inspect        自检统计：透明率等     {}
  save           导出透明 PNG            {output_path}

每次操作返回 image 字段（处理后效果图路径），前端会内嵌刷新到对话里。
"""
import os
import threading
import time

from PIL import Image, ImageDraw, ImageFilter

TOOL_NAME = 'vision_studio'

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
WORK_DIR = os.path.join(_THIS_DIR, '..', 'workspace')
os.makedirs(WORK_DIR, exist_ok=True)

_LOCK = threading.Lock()
_SESSION = {
    'original': None,   # 原始图 PIL RGBA
    'result': None,     # 当前结果 PIL RGBA
    'background': (255, 255, 255),
    'tolerance': 30,
    'feather': 1,
    'log': [],
}


def _log(action, params, extra=''):
    _SESSION['log'].append(
        {'t': time.strftime('%H:%M:%S'), 'action': action,
         'params': params, 'info': extra})


def _save_result(tag):
    name = '%d_%s.png' % (int(time.time() * 1000), tag)
    path = os.path.join(WORK_DIR, name)
    _SESSION['result'].save(path)
    return path


def _need_image():
    if _SESSION['result'] is None:
        raise RuntimeError('尚未打开图片，请先调用 action=open')
    return _SESSION['result']


# ---------------------------------------------------------------- 像素算法
def _load(path):
    img = Image.open(path).convert('RGBA')
    max_pixels = 12_000_000
    w, h = img.size
    if w * h > max_pixels:
        scale = (max_pixels / (w * h)) ** 0.5
        w, h = max(1, round(w * scale)), max(1, round(h * scale))
        img = img.resize((w, h), Image.NEAREST)
    return img


def _remove_background(img, bg, tolerance, feather):
    """按背景色容差去底，返回带 alpha 的新图（纯 Pillow 实现）。"""
    rgba = img.convert('RGBA')
    w, h = rgba.size
    # 建立背景 mask（0=背景, 255=前景），用逐像素 getdata 遍历
    pixels = list(rgba.getdata())
    r0, g0, b0 = bg
    t = max(0, int(tolerance))
    mask = Image.new('L', (w, h), 255)
    mask_data = bytearray([255]) * (w * h)
    for i, (r, g, b, a) in enumerate(pixels):
        if abs(r - r0) <= t and abs(g - g0) <= t and abs(b - b0) <= t:
            mask_data[i] = 0
    mask.putdata(mask_data)
    if feather and feather > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(feather))
    rgba.putalpha(mask)
    return rgba


# ---------------------------------------------------------------- 动作实现
def _open(body):
    path = body.get('image_path')
    if not path or not os.path.isfile(path):
        return {'ok': False, 'error': 'image_path 不存在: %r' % path}
    original = _load(path)
    bg = _SESSION['background']
    tol = _SESSION['tolerance']
    feather = _SESSION['feather']
    result = _remove_background(original, bg, tol, feather)
    _SESSION['original'] = original
    _SESSION['result'] = result
    # 统计清除像素
    alpha = result.getchannel('A')
    cleared = sum(1 for v in alpha.getdata() if v < 128)
    info = '已开图 %dx%d，背景=%s 容差=%d，清除像素=%d' % (
        original.width, original.height, list(bg), tol, cleared)
    _log('open', {'path': path}, info)
    return {'ok': True, 'info': info, 'image': _save_result('open')}


def _set_background(body):
    _need_image()
    bg = [body.get('r', 255), body.get('g', 255), body.get('b', 255)]
    tol = int(body.get('tolerance', _SESSION['tolerance']))
    feather = float(body.get('feather', _SESSION['feather']))
    _SESSION['background'] = tuple(int(v) for v in bg)
    _SESSION['tolerance'] = tol
    _SESSION['feather'] = feather
    result = _remove_background(_SESSION['original'], bg, tol, feather)
    _SESSION['result'] = result
    alpha = result.getchannel('A')
    cleared = sum(1 for v in alpha.getdata() if v < 128)
    info = '背景=%s 容差=%d 羽化=%s，清除像素=%d' % (bg, tol, feather, cleared)
    _log('set_background', {'bg': bg, 'tol': tol}, info)
    return {'ok': True, 'info': info, 'image': _save_result('set_bg')}


def _brush(body):
    result = _need_image().copy()
    original = _SESSION['original']
    mode = body.get('mode', 'erase')
    x, y = int(body.get('x', 0)), int(body.get('y', 0))
    radius = int(body.get('radius', 24))
    if mode == 'restore':
        patch = original.crop((max(0, x - radius), max(0, y - radius),
                               x + radius, y + radius)).convert('RGBA')
        mask = Image.new('L', patch.size, 255)
        d = ImageDraw.Draw(mask)
        d.ellipse([0, 0, patch.width - 1, patch.height - 1], fill=255)
        result.paste(patch, (max(0, x - radius), max(0, y - radius)), mask)
    else:  # erase
        d = ImageDraw.Draw(result)
        d.ellipse([x - radius, y - radius, x + radius, y + radius],
                  fill=(0, 0, 0, 0))
    _SESSION['result'] = result
    info = '%s 画笔 @(%d,%d) 半径=%d' % (
        '恢复' if mode == 'restore' else '擦除', x, y, radius)
    _log('brush', {'mode': mode, 'x': x, 'y': y}, info)
    return {'ok': True, 'info': info, 'image': _save_result('brush')}


def _crop(body):
    result = _need_image()
    x, y = int(body.get('x', 0)), int(body.get('y', 0))
    w, h = int(body.get('w', 0)), int(body.get('h', 0))
    W, H = result.size
    x2, y2 = min(W, x + w), min(H, y + h)
    if w <= 0 or h <= 0 or x >= x2 or y >= y2:
        return {'ok': False, 'error': '裁剪区域无效: (%d,%d,%d,%d) 图=%dx%d' % (x, y, w, h, W, H)}
    cropped = result.crop((x, y, x2, y2))
    _SESSION['result'] = cropped
    _SESSION['original'] = _SESSION['original'].crop((x, y, x2, y2))
    info = '已裁剪 (%d,%d)-(%d,%d) → %dx%d' % (x, y, x2, y2, cropped.width, cropped.height)
    _log('crop', {'x': x, 'y': y, 'w': w, 'h': h}, info)
    return {'ok': True, 'info': info, 'image': _save_result('crop')}


def _resize(body):
    result = _need_image()
    W, H = result.size
    w = int(body.get('width', 0))
    h = int(body.get('height', 0))
    if w <= 0 and h <= 0:
        return {'ok': False, 'error': '需提供 width 或 height'}
    if w <= 0:
        w = max(1, round(W * h / H))
    if h <= 0:
        h = max(1, round(H * w / W))
    resized = result.resize((w, h), Image.LANCZOS)
    _SESSION['result'] = resized
    _SESSION['original'] = _SESSION['original'].resize((w, h), Image.LANCZOS)
    info = '已缩放 %dx%d → %dx%d' % (W, H, w, h)
    _log('resize', {'w': w, 'h': h}, info)
    return {'ok': True, 'info': info, 'image': _save_result('resize')}


def _inspect(body):
    result = _need_image()
    alpha = result.getchannel('A')
    data = list(alpha.getdata())
    total = len(data)
    transparent = sum(1 for v in data if v < 128)
    info = '尺寸=%dx%d 总像素=%d 透明像素=%d 透明率=%.1f%%' % (
        result.width, result.height, total, transparent,
        transparent * 100.0 / total)
    return {'ok': True, 'info': info}


def _save(body):
    _need_image()
    out = body.get('output_path')
    if not out:
        return {'ok': False, 'error': '需提供 output_path'}
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    _SESSION['result'].save(out)
    _log('save', {'output': out})
    return {'ok': True, 'output': out, 'info': '已保存 ' + out}


# ---------------------------------------------------------------- Pillow 全家桶
def _apply_both(fn):
    """对 original 和 result 同步应用一个 PIL 变换，保持去底可重算。"""
    _SESSION['original'] = fn(_SESSION['original'])
    _SESSION['result'] = fn(_SESSION['result'])
    return _SESSION['result']


def _rotate(body):
    _need_image()
    angle = float(body.get('angle', 90))
    expand = bool(body.get('expand', True))
    _apply_both(lambda im: im.rotate(angle, expand=expand, resample=Image.BICUBIC))
    img = _SESSION['result']
    info = '已旋转 %.1f°，现 %dx%d' % (angle, img.width, img.height)
    _log('rotate', {'angle': angle}, info)
    return {'ok': True, 'info': info, 'image': _save_result('rotate')}


def _flip(body):
    _need_image()
    d = body.get('direction', 'h')
    im = Image.FLIP_LEFT_RIGHT if d == 'h' else Image.FLIP_TOP_BOTTOM
    _apply_both(lambda x: x.transpose(im))
    info = '已%s镜像' % ('水平' if d == 'h' else '垂直')
    _log('flip', {'direction': d}, info)
    return {'ok': True, 'info': info, 'image': _save_result('flip')}


_FILTERS = {
    'blur': ImageFilter.GaussianBlur, 'sharpen': ImageFilter.SHARPEN,
    'contour': ImageFilter.CONTOUR, 'emboss': ImageFilter.EMBOSS,
    'edge_enhance': ImageFilter.EDGE_ENHANCE, 'smooth': ImageFilter.SMOOTH,
    'detail': ImageFilter.DETAIL, 'grayscale': None, 'invert': None,
}


def _filter(body):
    _need_image()
    name = (body.get('name') or 'blur').lower()
    if name not in _FILTERS:
        return {'ok': False, 'error': '未知滤镜 %r，可用: %s' % (name, ', '.join(_FILTERS))}
    if name == 'grayscale':
        def f(im):
            return im.convert('LA').convert('RGBA')
    elif name == 'invert':
        def f(im):
            r, g, b, a = im.split()
            inv = Image.eval(Image.merge('RGB', (r, g, b)), lambda v: 255 - v)
            out = Image.merge('RGBA', (*inv.split(), a))
            return out
    elif name == 'blur':
        radius = float(body.get('radius', 2))
        f = lambda im: im.filter(ImageFilter.GaussianBlur(radius))
    else:
        f = lambda im: im.filter(_FILTERS[name])
    _apply_both(f)
    info = '已应用滤镜 %s' % name
    _log('filter', {'name': name}, info)
    return {'ok': True, 'info': info, 'image': _save_result('filter_' + name)}


def _adjust(body):
    from PIL import ImageEnhance
    _need_image()
    b = float(body.get('brightness', 1.0))
    c = float(body.get('contrast', 1.0))
    s = float(body.get('saturation', 1.0))
    sh = float(body.get('sharpness', 1.0))
    def f(im):
        for cls, v in ((ImageEnhance.Brightness, b), (ImageEnhance.Contrast, c),
                       (ImageEnhance.Color, s), (ImageEnhance.Sharpness, sh)):
            if v != 1.0:
                im = cls(im).enhance(v)
        return im
    _apply_both(f)
    info = '亮度=%s 对比度=%s 饱和度=%s 锐度=%s' % (b, c, s, sh)
    _log('adjust', {'b': b, 'c': c, 's': s, 'sh': sh}, info)
    return {'ok': True, 'info': info, 'image': _save_result('adjust')}


def _text(body):
    from PIL import ImageFont
    result = _need_image()
    txt = body.get('text')
    if not txt:
        return {'ok': False, 'error': '需提供 text'}
    x, y = int(body.get('x', 10)), int(body.get('y', 10))
    size = int(body.get('size', 32))
    color = tuple(body.get('color', [255, 0, 0, 255]))
    draw = ImageDraw.Draw(result)
    font_path = body.get('font_path')
    try:
        font = ImageFont.truetype(font_path, size) if font_path else ImageFont.truetype('msyh.ttc', size)
    except Exception:
        font = ImageFont.load_default()
    draw.text((x, y), txt, font=font, fill=color)
    info = '已绘制文字 %r 于 (%d,%d)' % (txt[:20], x, y)
    _log('text', {'text': txt, 'x': x, 'y': y}, info)
    return {'ok': True, 'info': info, 'image': _save_result('text')}


def _draw(body):
    result = _need_image()
    shape = body.get('shape', 'rect')
    coords = body.get('coords') or [0, 0, 100, 100]
    color = tuple(body.get('color', [255, 0, 0, 255]))
    width = int(body.get('width', 3))
    fill = tuple(body.get('fill', [])) if body.get('fill') else None
    draw = ImageDraw.Draw(result)
    if shape == 'rect':
        draw.rectangle(coords, outline=color, width=width, fill=fill)
    elif shape == 'ellipse':
        draw.ellipse(coords, outline=color, width=width, fill=fill)
    elif shape == 'line':
        draw.line(coords, fill=color, width=width)
    else:
        return {'ok': False, 'error': 'shape 需为 rect|ellipse|line'}
    info = '已绘制 %s %s' % (shape, coords)
    _log('draw', {'shape': shape}, info)
    return {'ok': True, 'info': info, 'image': _save_result('draw')}


def _paste(body):
    _need_image()
    src = body.get('image_path')
    if not src or not os.path.isfile(src):
        return {'ok': False, 'error': 'image_path 不存在: %r' % src}
    x, y = int(body.get('x', 0)), int(body.get('y', 0))
    overlay = Image.open(src).convert('RGBA')
    if body.get('width') or body.get('height'):
        w = int(body.get('width') or overlay.width * (body.get('height') / overlay.height))
        h = int(body.get('height') or overlay.height * (body.get('width') / overlay.width))
        overlay = overlay.resize((w, h), Image.LANCZOS)
    base = _apply_both(lambda im: im.copy())
    base.paste(overlay, (x, y), overlay)
    info = '已贴入 %s 于 (%d,%d)，叠加尺寸 %dx%d' % (os.path.basename(src), x, y, overlay.width, overlay.height)
    _log('paste', {'src': src, 'x': x, 'y': y}, info)
    return {'ok': True, 'info': info, 'image': _save_result('paste')}

_ACTIONS = {
    'open': _open,
    'set_background': _set_background,
    'brush': _brush,
    'crop': _crop,
    'resize': _resize,
    'inspect': _inspect,
    'save': _save,
    'rotate': _rotate, 'flip': _flip, 'filter': _filter, 'adjust': _adjust,
    'text': _text, 'draw': _draw, 'paste': _paste,
}


def handle(body, ctx):
    try:
        action = (body.get('action') or '').strip()
        fn = _ACTIONS.get(action)
        if not fn:
            return ctx.send_error(
                '未知 action: %r，可用: %s' % (action, ', '.join(_ACTIONS)))
        with _LOCK:
            result = fn(body)
        if not result.get('ok'):
            return ctx.send_error(result.get('error', '未知错误'))
        msg = '【视觉精修 %s】%s' % (action, result.get('info', ''))
        if action == 'save':
            msg = '已保存透明 PNG：%s' % result.get('output', '')
        return ctx.send_json({
            'ok': True,
            'message': msg,
            'image': result.get('image'),
            'output': result.get('output'),
        })
    except Exception as e:
        return ctx.send_error('%s: %s' % (type(e).__name__, e))
