# -*- coding: utf-8 -*-
import io, json, sys
sys.stdout.reconfigure(encoding='utf-8')
P = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\js\icons.js'
s = io.open(P, encoding='utf-8').read()
i = s.find('MAP = {'); j = s.find('};', i)
MAP = json.loads(s[i+6:j+1])

SVG = '<svg class="zf-svg" viewBox="1 1 22 22" width="1.18em" height="1.18em" style="vertical-align:-0.14em" aria-hidden="true">%s</svg>'
def enc(x): return x.replace('&','&amp;')

def grads(gid, c1, c2):
    return ('<defs><linearGradient id="%s" x1="0" y1="0" x2="0" y2="1">'
            '<stop offset="0" stop-color="%s"/><stop offset="1" stop-color="%s"/>'
            '</linearGradient></defs>') % (gid, c1, c2)

# 🆕 NEW 徽章：蓝青渐变圆角方块 + 白色 NEW
new_svg = SVG % (
    grads('gNew', '#4FC3F7', '#1E88E5') +
    '<rect x="2" y="4" width="20" height="16" rx="3.5" fill="url(#gNew)"/>'
    '<text x="12" y="12.6" text-anchor="middle" font-size="7.2" font-family="Arial,sans-serif" font-weight="700" fill="#fff">NEW</text>'
    '<rect x="5" y="15.4" width="14" height="1.6" rx="0.8" fill="#fff" opacity="0.55"/>'
)

# 🅰 A 型按钮：橙红渐变圆角 + 立体 A
a_svg = SVG % (
    grads('gA', '#FF8A65', '#F4511E') +
    '<rect x="3" y="3" width="18" height="18" rx="4" fill="url(#gA)"/>'
    '<path d="M12 6.2 L16.4 16.8 L13.8 16.8 L12.9 14.4 L11.1 14.4 L10.2 16.8 L7.6 16.8 Z M12 10 L11.7 12.2 L12.3 12.2 Z" fill="#fff"/>'
    '<rect x="7.6" y="6.6" width="6.8" height="1.4" rx="0.7" fill="#fff" opacity="0.5"/>'
)

# 🆔 ID 卡：青绿渐变卡片 + 头像 + ID 字样
id_svg = SVG % (
    grads('gId', '#4DD0C4', '#00897B') +
    '<rect x="2" y="4.5" width="20" height="15" rx="2.5" fill="url(#gId)"/>'
    '<rect x="2" y="4.5" width="20" height="2.6" rx="1.3" fill="#00695C" opacity="0.6"/>'
    '<circle cx="7.2" cy="12.4" r="2.3" fill="#fff" opacity="0.92"/>'
    '<path d="M3.6 18.2 Q7.2 14.6 10.8 18.2 L10.8 18.6 L3.6 18.6 Z" fill="#fff" opacity="0.92"/>'
    '<rect x="12.6" y="10.2" width="7.4" height="1.7" rx="0.85" fill="#fff" opacity="0.95"/>'
    '<rect x="12.6" y="13.4" width="5.6" height="1.7" rx="0.85" fill="#fff" opacity="0.7"/>'
)

MAP['🆕'] = enc(new_svg)
MAP['🅰'] = enc(a_svg)
MAP['🆔'] = enc(id_svg)

new_body = 'MAP = ' + json.dumps(MAP, ensure_ascii=False, separators=(',',':')) + ';'
s2 = s[:i] + new_body + s[j+1:]
io.open(P, 'w', encoding='utf-8').write(s2)
print('OK, total icons:', len(MAP))
