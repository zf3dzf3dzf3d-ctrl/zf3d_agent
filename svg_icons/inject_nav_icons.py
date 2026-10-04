# -*- coding: utf-8 -*-
"""给 icons.js 的 MAP 注入文件树工具栏按钮的统一风格 SVG（◀ ▶ ⬆ ⟳ ✕ 🔴🎥 配色），
与已有彩色渐变图标同一风格（gGray 渐变 + 圆角），渐变 id 唯一避免串色。
v2：修复注入位置/逗号 bug；跳过已存在键；刷新按钮加大视觉重量；录音按钮换柔和配色。"""
import re, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

P = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.5.0\public\js\icons.js'
src = io.open(P, encoding='utf-8').read()

def wrap(gid, body, c1='#B0BEC5', c2='#607D8B', sw='0.8'):
    return ('<svg class="zf-svg" viewBox="1 1 22 22" width="1.18em" height="1.18em" '
            'style="vertical-align:-0.22em" aria-hidden="true">'
            f'<defs><linearGradient id="{gid}" x1="0" y1="0" x2="0" y2="1">'
            f'<stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/>'
            f'</linearGradient></defs>{body}</svg>')

G = 'gNav'
icons = {
    # 向上箭头：数据源只有带 VS16 的 ⬆️，补裸字符别名（按钮里用的是裸 ⬆）
    '⬆': ('"⬆":MAP["⬆️"],'),

    # 后退/前进：实心三角+描边，与向上箭头同风格
    '◀': wrap(G+'_L', '<path d="M16.5 5.2v13.6c0 .9-1 1.4-1.7.9L6 13c-.7-.5-.7-1.5 0-2l8.8-6.6c.7-.5 1.7 0 1.7.8z" fill="url(#%s)" stroke="#455A64" stroke-width="0.9" stroke-linejoin="round"/>' % (G+'_L')),
    '▶': wrap(G+'_R', '<path d="M7.5 5.2v13.6c0 .9 1 1.4 1.7.9L18 13c.7-.5.7-1.5 0-2L9.2 4.4c-.7-.5-1.7 0-1.7.8z" fill="url(#%s)" stroke="#455A64" stroke-width="0.9" stroke-linejoin="round"/>' % (G+'_R')),
    # 刷新：粗壮的双箭头圆环，视觉重量与相邻图标匹配（原版太细显得小）
    '⟳': wrap(G+'_C', '<path d="M12 3.2a8.8 8.8 0 108.8 8.8h-3.1A5.7 5.7 0 1112 6.3V10l6.3-5.2L12 0.5V3.2z" fill="url(#%s)" stroke="#455A64" stroke-width="0.9" stroke-linejoin="round"/>' % (G+'_C')),
    '─': wrap(G+'_M', '<rect x="4" y="10.2" width="16" height="3.2" rx="1.6" fill="url(#%s)" stroke="#455A64" stroke-width="0.7"/>' % (G+'_M')),
    '✕': wrap(G+'_X', '<path d="M6.8 6.8l10.4 10.4M17.2 6.8L6.8 17.2" stroke="url(#%s)" stroke-width="3.2" stroke-linecap="round"/>' % (G+'_X')),
    # 录音（原 🔴 纯红太刺眼）：柔和的红粉渐变圆点 + 白色高光
    '🔴': wrap(G+'_Rec', '<circle cx="12" cy="12" r="8.2" fill="url(#%s)" stroke="#8E2430" stroke-width="0.8"/><circle cx="9.6" cy="9.4" r="2.4" fill="rgba(255,255,255,0.45)"/>' % (G+'_Rec'), c1='#FF7B8A', c2='#C62838'),
    # 录屏（原 🎥 裸色太杂）：蓝灰渐变电影摄像机
    '🎥': wrap(G+'_Cam', '<rect x="3" y="7" width="11" height="10" rx="2.2" fill="url(#%s)" stroke="#33518E" stroke-width="0.8"/><path d="M14.5 11l5.2-3.2c.5-.3 1.1.1 1.1.7v7c0 .6-.6 1-1.1.7L14.5 13z" fill="url(#%s)" stroke="#33518E" stroke-width="0.8" stroke-linejoin="round"/>' % (G+'_Cam', G+'_Cam'), c1='#7FA7E8', c2='#3D6CC4'),
}

# 检测已有键（在 JS 源里形如 ,"键": 或 {"键":）
existing = {k for k in icons if ('"%s":' % k) in src}
# ⬆ 特殊处理：值为 JS 表达式（引用 MAP["⬆️"]），先确认 ⬆️ 在 MAP 里
alias_ok = '"⬆️":' in src
todo = {}
for k, v in icons.items():
    if k in existing:
        continue
    if k == '⬆' and not alias_ok:
        continue
    todo[k] = v
if not todo:
    print('all keys already present, nothing to do')
    sys.exit(0)

m = re.search(r'var MAP = \{', src)
assert m, 'MAP not found'
add = ''.join(
    ('"%s":null,' % k) if (k == '⬆') else ('"%s":"%s",' % (k, v.replace('"', '\\"')))
    for k, v in todo.items()
)
src = src[:m.end()] + add + src[m.end():]
# 自引用别名放到 MAP 定义完成之后
src = src.replace('KEYS = Object.keys(MAP)', 'if (MAP["⬆"] === null) MAP["⬆"] = MAP["⬆️"];\n  KEYS = Object.keys(MAP)', 1)
io.open(P, 'w', encoding='utf-8').write(src)
print('injected:', list(todo), '| skipped(existing):', sorted(existing))
