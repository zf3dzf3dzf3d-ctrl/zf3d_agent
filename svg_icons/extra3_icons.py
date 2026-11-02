# -*- coding: utf-8 -*-
"""第三批补充图标：覆盖扫描出的遗漏 emoji（箭头/星形/天气/动物角色/功能符号）。
程序化生成：同模板 + 按码点色相变化，风格与 gen_color_icons 一致（扁平渐变、圆角）。
"""

def _hue(ch):
    return (ord(ch[0]) * 37) % 360

def _grad(gid, h1, h2):
    return ('<linearGradient id="%s" x1="0" y1="0" x2="0" y2="1">'
            '<stop offset="0" stop-color="hsl(%d,85%%,72%%)"/>'
            '<stop offset="1" stop-color="hsl(%d,75%%,50%%)"/></linearGradient>' % (gid, h1, h2))

def _svg(gid, body):
    return '<defs>%s</defs>%s' % (_grad(gid, *_hpair(gid)), body)

_HP = {}
def _hpair(gid):
    return _HP.get(gid, (210, 230))

def _mk(ch, body, h1=None, h2=None):
    gid = 'gX%04X' % ord(ch[0])
    _HP[gid] = (h1 if h1 is not None else _hue(ch), h2 if h2 is not None else ((_hue(ch) + 40) % 360))
    return _svg(gid, body)

# ---------- 具体绘制 ----------

def arrow(ch, rot):
    g = 'gX%04X' % ord(ch[0])
    _HP[g] = (_hue(ch), (_hue(ch) + 40) % 360)
    return ('<defs>%s</defs><g transform="rotate(%d 12 12)">'
            '<path d="M4 10h11l-3.2-3.2a1.4 1.4 0 012-2l6 6a1.4 1.4 0 010 2l-6 6a1.4 1.4 0 01-2-2L15 13H4a1.4 1.4 0 010-2.8z" fill="url(#%s)"/></g>'
            % (_grad(g, _HP[g][0], _HP[g][1]), rot, g))

def star(ch, points=5):
    import math
    g = 'gX%04X' % ord(ch[0])
    h = _hue(ch); _HP[g] = (h, (h + 40) % 360)
    pts = []
    R, r = 9.2, 3.9
    for i in range(points * 2):
        rad = math.pi * i / points - math.pi / 2
        rr = R if i % 2 == 0 else r
        pts.append('%.2f,%.2f' % (12 + rr * math.cos(rad), 12 + rr * math.sin(rad)))
    return '<defs>%s</defs><path d="M%sz" fill="url(#%s)" stroke="hsl(%d,70%%,45%%)" stroke-width=".6"/>' % (
        _grad(g, h, (h + 40) % 360), 'L'.join(pts), g, h)

def face(ch):
    """动物/角色：圆脸 + 耳朵 + 眼嘴"""
    g = 'gX%04X' % ord(ch[0])
    h = _hue(ch); _HP[g] = (h, (h + 35) % 360)
    return ('<defs>%s</defs>'
            '<circle cx="6.5" cy="7" r="3" fill="hsl(%d,60%%,45%%)"/><circle cx="17.5" cy="7" r="3" fill="hsl(%d,60%%,45%%)"/>'
            '<circle cx="12" cy="12.5" r="8" fill="url(#%s)"/>'
            '<circle cx="9" cy="11" r="1.3" fill="#fff"/><circle cx="15" cy="11" r="1.3" fill="#fff"/>'
            '<circle cx="9.3" cy="11.3" r=".7" fill="#333"/><circle cx="15.3" cy="11.3" r=".7" fill="#333"/>'
            '<path d="M10 15.5q2 1.8 4 0" stroke="#5D4037" stroke-width="1.2" fill="none" stroke-linecap="round"/>'
            '<ellipse cx="12" cy="13.6" rx="1.4" ry="1" fill="hsl(%d,50%%,35%%)"/>'
            % (_grad(g, h, (h + 35) % 360), h, h, g, h))

def cloud(ch, sun=False):
    g = 'gX%04X' % ord(ch[0])
    h = _hue(ch); _HP[g] = (h, (h + 30) % 360)
    s = '<circle cx="9" cy="8" r="3.6" fill="url(#gSunY)"/><g stroke="#F9A825" stroke-width="1.4" stroke-linecap="round"><path d="M9 2.6v1.6M9 11.8v.6M3.6 8h1.6M12.8 8h.6M5.2 4.2l1.1 1.1M11.7 10.7l1.1 1.1M12.8 4.2l-1.1 1.1"/></g>' if sun else ''
    return ('<defs>%s<linearGradient id="gSunY" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE082"/><stop offset="1" stop-color="#F9A825"/></linearGradient></defs>'
            '%s<g transform="translate(1.5 3) scale(.92)"><path d="M7 18a4 4 0 01-.6-7.95A5.5 5.5 0 0117 8.6 4.2 4.2 0 0116.8 17z" fill="url(#%s)" stroke="hsl(%d,55%%,60%%)" stroke-width=".7"/></g>'
            % (_grad(g, h, (h + 30) % 360), s, g, h))

def rain(ch, bolt=False):
    g = 'gX%04X' % ord(ch[0])
    h = _hue(ch); _HP[g] = (h, (h + 30) % 360)
    drops = '<path d="M13.5 8l-2 3.6h2.2l-1.6 3.2" stroke="#FFC107" stroke-width="1.5" fill="none" stroke-linejoin="round"/>' if bolt else \
            '<g stroke="#4FC3F7" stroke-width="1.6" stroke-linecap="round"><path d="M8 18.5l-.9 2M12 18.5l-.9 2M16 18.5l-.9 2"/></g>'
    return ('<defs>%s</defs><g transform="translate(1.5 -1) scale(.92)"><path d="M7 15a4 4 0 01-.6-7.95A5.5 5.5 0 0117 4.6 4.2 4.2 0 0116.8 13z" fill="url(#%s)" stroke="hsl(%d,55%%,60%%)" stroke-width=".7"/></g>%s'
            % (_grad(g, h, (h + 30) % 360), g, h, drops))

def badge(ch):
    """兜底：圆角徽章 + 简单高光"""
    g = 'gX%04X' % ord(ch[0])
    h = _hue(ch); _HP[g] = (h, (h + 40) % 360)
    return ('<defs>%s</defs><rect x="3.5" y="3.5" width="17" height="17" rx="5" fill="url(#%s)"/>'
            '<rect x="6" y="5.5" width="12" height="4" rx="2" fill="#fff" opacity=".28"/>'
            '<circle cx="12" cy="14.5" r="2.6" fill="#fff" opacity=".85"/>'
            % (_grad(g, h, (h + 40) % 360), g))

# ---------- 分类清单 ----------
ARROWS = {
    '➕': 0, '➡': 0, '➤': 0, '⤴': -45, '⤓': 90, '⬅': 180, '⤡': -135, '⤢': -45,
    '↩': -120, '↪': 120, '⬆': -90, '⬇': 90, '➔': 0, '➜': 0, '⬛': 0,
}
ARROWS.pop('⬛')
STARS = ['★', '☆', '✦', '✧', '✺', '✿', '❅', '❄']
CLOUD_SUN = ['⛅', '🌤', '🌦', '⛅']
CLOUD_ONLY = ['☁', '🌫']
RAIN = ['☂', '🌧', '🌨', '⛈']
FACES = ['🐔', '🐨', '🐮', '🐯', '🐰', '🐱', '🐴', '🐵', '🐶', '🐷', '🐸', '🐹', '🐺', '🐻', '🐼',
         '🦁', '🦄', '🦉', '🦊', '👷', '👸', '👻', '👽', '🤠', '🤴', '🦸', '🥷', '🧚', '🧛', '🧜', '🧟',
         '😎', '🙂', '🤓', '💸']
WEATHER_MISC = ['☄', '-lightning']

SPEC = {}

def _reg(ch, body):
    SPEC[ch] = body

# 功能符号（手绘）
_reg('☐', '<rect x="4.5" y="4.5" width="15" height="15" rx="3" fill="none" stroke="#78909C" stroke-width="2.2"/><rect x="8" y="8" width="8" height="8" rx="1.5" fill="#B0BEC5" opacity=".45"/>')
_reg('✂', '<g stroke="#546E7A" stroke-width="1.9" fill="none" stroke-linecap="round"><circle cx="6.5" cy="7" r="2.6"/><circle cx="6.5" cy="17" r="2.6"/><path d="M8.8 8.5L19 17M8.8 15.5L19 7"/></g>')
_reg('✉', '<defs><linearGradient id="gXenv" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF9C4"/><stop offset="1" stop-color="#FBC02D"/></linearGradient></defs><rect x="3" y="5.5" width="18" height="13" rx="2" fill="url(#gXenv)" stroke="#F9A825" stroke-width=".8"/><path d="M3.5 6.5L12 13l8.5-6.5" fill="none" stroke="#F9A825" stroke-width="1.4"/>')
_reg('✋', '<circle cx="12" cy="12" r="8.5" fill="#FFCC80"/><g stroke="#E6B26B" stroke-width="1.1" stroke-linecap="round"><path d="M8.5 12v-4M10.8 12V7.5M13.2 12V7.8M15.5 12V9"/></g>')
_reg('✎', '<path d="M5 19l1-4L16.5 4.5a2 2 0 013 3L9 18l-4 1z" fill="#FFB74D" stroke="#F57C00" stroke-width="1"/><path d="M15.5 5.5l3 3" stroke="#F57C00" stroke-width="1"/>')
_reg('✔', '<path d="M4.5 12.5l5 5L19.5 7" fill="none" stroke="#43A047" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>')
_reg('✖', '<g stroke="#E53935" stroke-width="3.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></g>')
_reg('♾', '<path d="M7.5 9a3 3 0 000 6c2.5 0 4.5-6 7-6a3 3 0 010 6c-2.5 0-4.5-6-7-6z" fill="none" stroke="#7E57C2" stroke-width="2.4" stroke-linecap="round"/>')
_reg('⚪', '<circle cx="12" cy="12" r="8" fill="#ECEFF1" stroke="#B0BEC5" stroke-width="1.4"/>')
_reg('⚫', '<circle cx="12" cy="12" r="8" fill="#37474F"/><circle cx="9.5" cy="9" r="2" fill="#fff" opacity=".25"/>')
_reg('⚽', '<circle cx="12" cy="12" r="8.5" fill="#fff" stroke="#455A64" stroke-width="1.3"/><path d="M12 7.5l3.8 2.8-1.5 4.4h-4.6L8.2 10.3z" fill="#37474F"/><path d="M12 3.5v4M4.8 9.5l3.4.8M19.2 9.5l-3.4.8M7.5 19.5l2.2-4.8M16.5 19.5l-2.2-4.8" stroke="#455A64" stroke-width="1.1" fill="none"/>')
_reg('⬚', '<rect x="4.5" y="4.5" width="15" height="15" rx="2" fill="none" stroke="#90A4AE" stroke-width="1.6" stroke-dasharray="3 2.4"/>')
_reg('❐', '<rect x="4" y="7" width="13" height="13" rx="2" fill="url(#gXwin)"/><path d="M8 4h12v12" fill="none" stroke="#64B5F6" stroke-width="2.2" stroke-linecap="round"/><defs><linearGradient id="gXwin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#90CAF9"/><stop offset="1" stop-color="#1E88E5"/></linearGradient></defs>')
_reg('⤢', arrow('⤢', -45)); SPEC.pop('⤢')
_reg('⤡', arrow('⤡', -135)); SPEC.pop('⤡')
_reg('⤓', arrow('⤓', 90)); SPEC.pop('⤓')
_reg('⤴', arrow('⤴', -45)); SPEC.pop('⤴')
_reg('⬅', arrow('⬅', 180)); SPEC.pop('⬅')
_reg('⛶', '<path d="M4 4h16v16H4z" fill="none" stroke="#78909C" stroke-width="2"/><path d="M9 4v5H4M15 20v-5h5" fill="none" stroke="#4FA3E3" stroke-width="2.2" stroke-linecap="round"/>')
_reg('🏖', '<circle cx="8.5" cy="7.5" r="2.8" fill="#FFE082"/><path d="M2.5 16.5c3-3.5 8-4.5 12-3l4 3z" fill="#FFD54F"/><path d="M3 19.5c4-2.5 12-2.5 18 0z" fill="#4FC3F7"/>')
_reg('🕸', '<g stroke="#90A4AE" stroke-width="1.1" fill="none"><circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="6.4"/><circle cx="12" cy="12" r="9.2"/><path d="M12 2.8v18.4M2.8 12h18.4M5.5 5.5l13 13M18.5 5.5l-13 13"/></g>')

def build():
    mapping = {}
    for ch, rot in ARROWS.items():
        mapping[ch] = arrow(ch, rot)
    for ch in STARS:
        mapping[ch] = star(ch, 4 if ch in ('✦', '✧') else 5)
    for ch in CLOUD_SUN:
        mapping[ch] = cloud(ch, sun=True)
    for ch in CLOUD_ONLY:
        mapping[ch] = cloud(ch)
    for ch in RAIN:
        mapping[ch] = rain(ch, bolt=(ch == '⛈'))
    for ch in FACES:
        mapping[ch] = face(ch)
    # 专属手绘头像（avatar_redraw）：覆盖通用 face 模板，保证每个头像轮廓独特
    try:
        from avatar_redraw import build_avatars
        for ch, body in build_avatars().items():
            mapping[ch] = body
    except Exception:
        pass
    for ch, body in SPEC.items():
        mapping[ch] = body
    # 其余遗漏全部用徽章兜底（由 build_icons_js 传入缺失清单）
    return mapping

def fill_missing(mapping, missing_list):
    """missing_list: 扫描出的仍未覆盖 emoji，用徽章兜底"""
    for ch in missing_list:
        if ch not in mapping:
            mapping[ch] = badge(ch)
    return mapping
