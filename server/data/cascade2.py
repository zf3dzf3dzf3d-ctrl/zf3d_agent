# -*- coding: utf-8 -*-
"""最后一轮定位：
1) settings-modal 片段里是否有 settings-nav（用宽松匹配，前面严格引号匹配失败）
2) #modelConfigPanel 是被 append 进 .settings-modal/.settings-content 还是留在原处
3) .settings-nav 全部 background 规则（含 settings-toggles/style-settings-nav），确定谁生效
"""
import re, os
ROOT = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.6.0'
P = lambda *a: os.path.join(ROOT, *a)
rd = lambda fp: open(fp, encoding='utf-8', errors='replace').read()

dom = rd(P('public', 'js', 'dom-settings-panel.js'))
print('1) dom-settings-panel.js 片段检查')
print('   含 settings-nav 出现次数 :', dom.count('settings-nav'))
m = re.search(r'panelNav|settings-nav', dom)
print('   首个上下文:', ' '.join(dom[m.start()-60:m.start()+160].split()) if m else 'NA')
print('   含 modelConfigPanel      :', dom.count('modelConfigPanel'))

print('')
print('2) 谁把 modelConfigPanel 放进设置弹窗 / 或它自身就在弹窗内')
for f in sorted(os.listdir(P('public', 'js'))):
    if not f.endswith('.js'):
        continue
    c = rd(P('public', 'js', f))
    for mm in re.finditer(r"[^\n]{0,130}modelConfigPanel[^\n]{0,130}", c):
        seg = ' '.join(mm.group(0).split())
        if re.search(r'appendChild|insertBefore|settings-|panelContent|replaceWith|\.append', seg):
            print('   %-28s | %s' % (f, seg[:200]))

print('')
print('3) 所有 .settings-nav 的 background 规则（文件:行）')
for rel in ['css/splits/split-10-settings.css', 'css/settings-toggles.css', 'css/style-settings-nav.css', 'css/tools-settings-dark.css', 'css/style-workbench.css']:
    fp = P('public', *rel.split('/'))
    if not os.path.exists(fp):
        continue
    c = rd(fp)
    for mm in re.finditer(r'([^{}]{0,110}\.settings-nav[^{}]{0,60})\{([^{}]{0,220})\}', c, re.S):
        s = ' '.join(mm.group(1).split())
        b = ' '.join(mm.group(2).split())
        if 'background' in b:
            print('   %-28s | %s => %s' % (os.path.basename(rel), s[-95:], b[:120]))
