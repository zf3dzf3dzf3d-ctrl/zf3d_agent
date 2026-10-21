# -*- coding: utf-8 -*-
"""Mixin: 图片工作台后端（AI 图片工具注册表 + 执行引擎 v1）

- GET  /api/workbench/tools           → 工具注册表（名称/描述/参数 schema，供 AI 与前端动态渲染）
- POST /api/workbench/tools/apply     → 执行工具：{tool, image(dataURL), params}
  返回 {ok, tool, resultUrl, meta}；结果图落到 public/data/workbench/，前端直接作为新图层加载。

设计原则：每个工具 = 一个纯函数 (PIL.Image, params) → (PIL.Image, meta)。
新增工具只要在 TOOLS 注册即可，AI 通过注册表自主发现与调用。
"""
import os
import io
import time
import base64
import traceback
from routes._shared import *
from routes.mixin_base import MixinBase

try:
    from PIL import Image, ImageEnhance, ImageFilter, ImageOps, ImageDraw, ImageChops
except Exception:
    Image = None

_WB_OUT_DIR = os.path.join(PUBLIC_DIR, 'data', 'workbench')
os.makedirs(_WB_OUT_DIR, exist_ok=True)


# ============================ 工具实现（纯函数） ============================

def _t_rotate(img, p):
    deg = float(p.get('angle', 90))
    out = img.rotate(-deg, expand=True, fillcolor=(0, 0, 0, 0) if img.mode == 'RGBA' else None)
    return out, {'angle': deg}

def _t_flip(img, p):
    d = p.get('direction', 'horizontal')
    return img.transpose(Image.FLIP_LEFT_RIGHT if d == 'horizontal' else Image.FLIP_TOP_BOTTOM), {'direction': d}

def _t_crop(img, p):
    x, y = int(p.get('x', 0)), int(p.get('y', 0))
    w, h = int(p.get('width', img.width)), int(p.get('height', img.height))
    box = (max(0, x), max(0, y), min(img.width, x + w), min(img.height, y + h))
    return img.crop(box), {'box': box}

def _t_resize(img, p):
    w = int(p.get('width', 0)); h = int(p.get('height', 0))
    if not w and not h:
        return img, {'note': 'no size given'}
    if w and not h:
        h = round(img.height * w / img.width)
    if h and not w:
        w = round(img.width * h / img.height)
    return img.resize((w, h), Image.LANCZOS), {'width': w, 'height': h}

def _t_scale_up(img, p):
    f = max(1.0, min(4.0, float(p.get('factor', 2))))
    w, h = round(img.width * f), round(img.height * f)
    up = img.resize((w, h), Image.LANCZOS)
    up = up.filter(ImageFilter.SMOOTH_MORE).filter(ImageFilter.UnsharpMask(radius=2, percent=80, threshold=2))
    return up, {'width': w, 'height': h, 'factor': f}

def _t_brightness(img, p):
    return ImageEnhance.Brightness(img).enhance(float(p.get('factor', 1.2))), {}

def _t_contrast(img, p):
    return ImageEnhance.Contrast(img).enhance(float(p.get('factor', 1.2))), {}

def _t_saturation(img, p):
    return ImageEnhance.Color(img).enhance(float(p.get('factor', 1.3))), {}

def _t_sharpness(img, p):
    return ImageEnhance.Sharpness(img).enhance(float(p.get('factor', 1.5))), {}

def _t_blur(img, p):
    r = max(0.1, float(p.get('radius', 2)))
    return img.filter(ImageFilter.GaussianBlur(r)), {'radius': r}

def _t_sharpen_filter(img, p):
    return img.filter(ImageFilter.UnsharpMask(radius=float(p.get('radius', 2)),
        percent=int(p.get('percent', 120)), threshold=int(p.get('threshold', 3)))), {}

def _t_grayscale(img, p):
    return ImageOps.grayscale(img).convert('RGBA' if img.mode == 'RGBA' else 'RGB'), {}

def _t_invert(img, p):
    return ImageOps.invert(img.convert('RGB')).convert(img.mode), {}

def _t_autocontrast(img, p):
    return ImageOps.autocontrast(img.convert('RGB'), cutoff=int(p.get('cutoff', 1))).convert(img.mode), {}

def _t_equalize(img, p):
    return ImageOps.equalize(img.convert('RGB')).convert(img.mode), {}

def _t_sepia(img, p):
    g = ImageOps.grayscale(img.convert('RGB'))
    tone = ImageOps.colorize(g, black=(30, 20, 5), white=(255, 240, 200), mid=(180, 140, 90))
    return tone.convert(img.mode), {}

def _t_posterize(img, p):
    bits = max(1, min(8, int(p.get('bits', 3))))
    return ImageOps.posterize(img.convert('RGB'), bits).convert(img.mode), {'bits': bits}

def _t_pixelate(img, p):
    block = max(2, int(p.get('block', 10)))
    small = img.resize((max(1, img.width // block), max(1, img.height // block)), Image.NEAREST)
    return small.resize(img.size, Image.NEAREST), {'block': block}

def _t_contour(img, p):
    return img.convert('L').filter(ImageFilter.CONTOUR).convert('RGB'), {}

def _t_edge(img, p):
    return img.convert('L').filter(ImageFilter.FIND_EDGES).convert('RGB'), {}

def _t_emboss(img, p):
    return img.filter(ImageFilter.EMBOSS), {}

def _t_color_balance(img, p):
    r = float(p.get('r', 1.0)); g = float(p.get('g', 1.0)); b = float(p.get('b', 1.0))
    rgb = img.convert('RGB').split()
    ch = []
    for chan, f in zip(rgb, (r, g, b)):
        ch.append(chan.point(lambda v, f=f: max(0, min(255, int(v * f)))))
    out = Image.merge('RGB', ch)
    return out.convert(img.mode), {'r': r, 'g': g, 'b': b}

def _t_threshold(img, p):
    t = max(0, min(255, int(p.get('value', 128))))
    g = img.convert('L')
    return g.point(lambda v: 255 if v > t else 0).convert(img.mode), {'threshold': t}

def _t_watermark(img, p):
    text = str(p.get('text', 'ZF'))[:40]
    op = max(0.05, min(1.0, float(p.get('opacity', 0.35))))
    pos = str(p.get('position', 'bottom-right'))
    img = img.convert('RGBA')
    layer = Image.new('RGBA', img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    try:
        from PIL import ImageFont
        font = ImageFont.load_default(size=max(14, img.width // 25))
    except Exception:
        font = None
    tw = int(len(text) * img.width / 18) + 40
    th = img.height // 12 + 12
    xy = {'bottom-right': (img.width - tw - 12, img.height - th - 12),
          'bottom-left': (12, img.height - th - 12),
          'top-right': (img.width - tw - 12, 12),
          'top-left': (12, 12),
          'center': ((img.width - tw) // 2, (img.height - th) // 2)}.get(pos, (12, img.height - th - 12))
    d.text(xy, text, fill=(255, 255, 255, int(255 * op)), font=font, stroke_width=2, stroke_fill=(0, 0, 0, int(255 * op)))
    return Image.alpha_composite(img, layer), {'text': text}

def _t_replace_color(img, p):
    """近色替换：from=[r,g,b] to=[r,g,b] tolerance(0-255)"""
    src = tuple(int(v) for v in p.get('from', [255, 0, 255]))
    dst = tuple(int(v) for v in p.get('to', [0, 255, 0]))
    tol = max(0, min(255, int(p.get('tolerance', 40))))
    img = img.convert('RGBA')
    data = img.getdata()
    out = []
    for px in data:
        r, g, b, a = px
        if abs(r - src[0]) <= tol and abs(g - src[1]) <= tol and abs(b - src[2]) <= tol:
            out.append((dst[0], dst[1], dst[2], a))
        else:
            out.append(px)
    img.putdata(out)
    return img, {'from': src, 'to': dst, 'tolerance': tol}

def _t_remove_bg_color(img, p):
    """纯色去背景：将接近指定颜色的像素透明化"""
    key = tuple(int(v) for v in p.get('color', [255, 255, 255]))
    tol = max(0, min(255, int(p.get('tolerance', 30))))
    img = img.convert('RGBA')
    data = img.getdata()
    out = []
    for px in data:
        r, g, b, a = px
        if abs(r - key[0]) <= tol and abs(g - key[1]) <= tol and abs(b - key[2]) <= tol:
            out.append((r, g, b, 0))
        else:
            out.append(px)
    img.putdata(out)
    return img, {'key': key, 'tolerance': tol}

def _t_pad(img, p):
    """加边框/画布扩展"""
    size = int(p.get('size', 40)); color = tuple(int(v) for v in p.get('color', [255, 255, 255]))
    return ImageOps.expand(img.convert('RGB'), border=size, fill=color), {'border': size}

def _t_flatten(img, p):
    color = tuple(int(v) for v in p.get('color', [255, 255, 255]))
    bg = Image.new('RGB', img.size, color)
    if img.mode in ('RGBA', 'LA'):
        bg.paste(img, mask=img.split()[-1])
    else:
        bg.paste(img.convert('RGB'))
    return bg, {}


TOOLS = {
    # ===== 核心工具（core=1，AI 工具表暴露；面板平铺）=====
    'rotate':        {'fn': _t_rotate,        'desc': '旋转图片', 'core': 1, 'params': {'angle': 'number 角度(顺时针为正) 默认90'}},
    'flip':          {'fn': _t_flip,          'desc': '水平/垂直翻转', 'core': 1, 'params': {'direction': '"horizontal"|"vertical"'}},
    'crop':          {'fn': _t_crop,          'desc': '裁剪区域', 'core': 1, 'params': {'x': 'int', 'y': 'int', 'width': 'int', 'height': 'int'}},
    'resize':        {'fn': _t_resize,        'desc': '缩放到指定宽高（可只给一边等比）', 'core': 1, 'params': {'width': 'int?', 'height': 'int?'}},
    'scale_up':      {'fn': _t_scale_up,      'desc': '放大(1~4倍)+锐化平滑', 'core': 1, 'params': {'factor': 'number 1~4 默认2'}},
    'brightness':    {'fn': _t_brightness,    'desc': '亮度', 'core': 1, 'params': {'factor': 'number <1变暗 >1变亮'}},
    'contrast':      {'fn': _t_contrast,      'desc': '对比度', 'core': 1, 'params': {'factor': 'number'}},
    'watermark':     {'fn': _t_watermark,     'desc': '加文字水印', 'core': 1, 'params': {'text': 'str', 'opacity': 'number?', 'position': 'str? bottom-right/bottom-left/top-right/top-left/center'}},
    'replace_color': {'fn': _t_replace_color, 'desc': '近色替换(把某颜色换成另一颜色)', 'core': 1, 'params': {'from': '[r,g,b]', 'to': '[r,g,b]', 'tolerance': 'int? 0~255 默认40'}},
    'remove_bg_color': {'fn': _t_remove_bg_color, 'desc': '纯色去背景(指定颜色变透明,白底图传color=[255,255,255])', 'core': 1, 'params': {'color': '[r,g,b]', 'tolerance': 'int? 默认30'}},
    'pad':           {'fn': _t_pad,           'desc': '加边框/扩画布', 'core': 1, 'params': {'size': 'int', 'color': '[r,g,b]?'}},
    'flatten':       {'fn': _t_flatten,       'desc': '透明背景铺底色', 'core': 1, 'params': {'color': '[r,g,b]?'}},
    # ===== 演示级滤镜（不进 AI 工具表；前端面板收进「更多滤镜」折叠区）=====
    'saturation':    {'fn': _t_saturation,    'desc': '饱和度', 'params': {'factor': 'number 0变灰'}},
    'sharpness':     {'fn': _t_sharpness,     'desc': '锐度增强', 'params': {'factor': 'number'}},
    'blur':          {'fn': _t_blur,          'desc': '高斯模糊', 'params': {'radius': 'number'}},
    'sharpen_filter': {'fn': _t_sharpen_filter, 'desc': 'USM锐化滤镜', 'params': {'radius': 'number?', 'percent': 'int?', 'threshold': 'int?'}},
    'grayscale':     {'fn': _t_grayscale,     'desc': '灰度化', 'params': {}},
    'invert':        {'fn': _t_invert,        'desc': '反色', 'params': {}},
    'autocontrast':  {'fn': _t_autocontrast,  'desc': '自动对比度拉伸', 'params': {'cutoff': 'int? 0~10'}},
    'equalize':      {'fn': _t_equalize,      'desc': '直方图均衡化', 'params': {}},
    'sepia':         {'fn': _t_sepia,         'desc': '复古棕褐色调', 'params': {}},
    'posterize':     {'fn': _t_posterize,     'desc': '色调分离(海报化)', 'params': {'bits': 'int 1~8 默认3'}},
    'pixelate':      {'fn': _t_pixelate,      'desc': '马赛克像素化', 'params': {'block': 'int 块大小 默认10'}},
    'contour':       {'fn': _t_contour,       'desc': '轮廓线提取', 'params': {}},
    'edge':          {'fn': _t_edge,          'desc': '边缘检测', 'params': {}},
    'emboss':        {'fn': _t_emboss,        'desc': '浮雕效果', 'params': {}},
    'color_balance': {'fn': _t_color_balance, 'desc': 'RGB色彩平衡', 'params': {'r': 'number', 'g': 'number', 'b': 'number'}},
    'threshold':     {'fn': _t_threshold,     'desc': '二值化', 'params': {'value': 'int 0~255'}},
}


def _tools_meta(all_flag=False):
    """工具注册表：默认只出核心工具（AI/前端主面板）；all=1 时出全部（「更多滤镜」折叠区）。"""
    return [
        {'name': k, 'description': v['desc'], 'params': v['params']}
        for k, v in TOOLS.items() if all_flag or v.get('core')
    ]


# ============================ HTTP 处理 ============================

class MixinWorkbench(MixinBase):

    def _handle_wb_tools_list(self):
        # ?all=1 返回全部工具（含演示滤镜）；默认只出核心 12 个
        all_flag = 'all=1' in (urlparse(self.path).query or '')
        meta = _tools_meta(all_flag=all_flag)
        self._send_json({'ok': True, 'count': len(meta), 'tools': meta})

    def _handle_wb_tools_apply(self, body):
        if Image is None:
            self._send_json({'ok': False, 'err': 'Pillow 未安装，无法执行图像工具'}, 500)
            return
        try:
            tool = str(body.get('tool', '')).strip()
            if tool not in TOOLS:
                self._send_json({'ok': False, 'err': f'未知工具: {tool}（GET /api/workbench/tools 查看列表）'}, 400)
                return
            dataurl = str(body.get('image', ''))
            m = dataurl.find('base64,')
            if m < 0:
                self._send_json({'ok': False, 'err': 'image 必须是 dataURL(base64)'}, 400)
                return
            raw = base64.b64decode(dataurl[m + 7:])
            img = Image.open(io.BytesIO(raw))
            params = body.get('params') or {}
            fn = TOOLS[tool]['fn']
            out, meta = fn(img, params)
            # 输出 PNG（保留透明）
            buf = io.BytesIO()
            out.save(buf, 'PNG')
            fname = 'wb_%s_%d.png' % (tool, int(time.time() * 1000))
            with open(os.path.join(_WB_OUT_DIR, fname), 'wb') as f:
                f.write(buf.getvalue())
            self._send_json({
                'ok': True, 'tool': tool, 'meta': meta,
                'resultUrl': '/data/workbench/' + fname,
                'width': out.width, 'height': out.height,
            })
        except Exception as e:
            print('[POST /api/workbench/tools/apply] 500: %s' % e)
            traceback.print_exc()
            self._send_json({'ok': False, 'err': str(e)}, 500)

    # ---------- 状态持久化（图片工作台图层/历史，存 SQLite） ----------
    def _handle_wb_state_post(self, body):
        try:
            import json as _json, sqlite3
            slot = str(body.get('slot', 'default')).strip() or 'default'
            state = body.get('state')
            # v5.2.2 防膨胀：内嵌 dataURL 大图不入库（曾致单行 23MB、库 22MB）。
            # 图层大图要求前端先落盘为 URL（public/data/workbench/），state 只存引用。
            dropped = {'n': 0}
            if isinstance(state, dict) and isinstance(state.get('layers'), list):
                for _ly in state['layers']:
                    if isinstance(_ly, dict) and isinstance(_ly.get('data'), str) \
                            and _ly['data'].startswith('data:') and len(_ly['data']) > 1024 * 1024:
                        _ly['data'] = ''
                        _ly['dataDropped'] = True
                        dropped['n'] += 1
            raw = _json.dumps(state, ensure_ascii=False)
            if len(raw) > 4 * 1024 * 1024:  # 双保险：整体仍超 4MB 则拒绝入库
                self._send_json({'ok': False, 'err': 'state too large (%d KB), reduce embedded images' % (len(raw) // 1024)}, 413)
                return
            _wb_db = os.path.join(BASE_DIR, 'data', 'game_saves.db')
            os.makedirs(os.path.dirname(_wb_db), exist_ok=True)
            conn = sqlite3.connect(_wb_db)
            try:
                conn.execute('CREATE TABLE IF NOT EXISTS saves (key TEXT PRIMARY KEY, data TEXT, updated REAL)')
                conn.execute('INSERT OR REPLACE INTO saves (key, data, updated) VALUES (?,?,?)',
                             ('workbench_state_' + slot, _json.dumps(state, ensure_ascii=False), time.time()))
                conn.commit()
            finally:
                conn.close()
            self._send_json({'ok': True, 'droppedImages': dropped['n']})
        except Exception as e:
            self._send_json({'ok': False, 'err': str(e)}, 500)

    def _handle_wb_state_get(self):
        try:
            import json as _json, sqlite3
            from urllib.parse import unquote as _unquote
            q = urlparse(self.path).query
            slot = 'default'
            for kv in q.split('&'):
                if kv.startswith('slot='):
                    slot = _unquote(kv[5:]) or 'default'   # 前端 encodeURIComponent，需解码对齐 POST 存储的 key
            _wb_db = os.path.join(BASE_DIR, 'data', 'game_saves.db')
            os.makedirs(os.path.dirname(_wb_db), exist_ok=True)
            conn = sqlite3.connect(_wb_db)
            try:
                conn.execute('CREATE TABLE IF NOT EXISTS saves (key TEXT PRIMARY KEY, data TEXT, updated REAL)')
                row = conn.execute('SELECT data FROM saves WHERE key=?', ('workbench_state_' + slot,)).fetchone()
            finally:
                conn.close()
            self._send_json({'ok': True, 'state': _json.loads(row[0]) if row else None})
        except Exception as e:
            self._send_json({'ok': False, 'err': str(e)}, 500)
