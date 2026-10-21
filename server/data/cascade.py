# -*- coding: utf-8 -*-
"""可靠验证（无浏览器）：
A. 括号配对确定 .settings-modal 元素的 DOM 范围，检查 modelConfigPanel / settings-content / settings-nav 是否在其中；
B. 抽取 index.html 真实引入顺序里所有「面板相关 background 规则」，带特异性/!important/主题，便于精确判断层叠结果。"""
import re, os
ROOT = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.6.0'
P = lambda *a: os.path.join(ROOT, *a)
rd = lambda fp: open(fp, encoding='utf-8', errors='replace').read()

TAG = re.compile(r'<(/?)div\b', re.I)


def div_span(text, start):
    """从 start(指向某个 <div) 开始，做 <div>/</div> 配对，返回结束位置。"""
    depth = 0
    for m in TAG.finditer(text, start):
        depth += -1 if m.group(1) else 1
        if depth == 0:
            end = text.find('>', m.end()) + 1
            return text[start:end]
    return None


print('=== A. DOM 归属核查 ===')
idx = rd(P('public', 'index.html'))
dom = rd(P('public', 'js', 'dom-settings-panel.js'))
for name, txt in [('index.html', idx), ('dom-settings-panel.js', dom)]:
    for m in re.finditer(r'<div\b[^>]*class=(\\?)"[^"\\]*settings-modal[^"\\]*\1', txt):
        frag = div_span(txt, m.start())
        if not frag:
            print('  %s: 配对失败' % name)
            continue
        head = ' '.join(frag[:80].split())
        print('  %-22s 外壳头: %s' % (name, head))
        print('     片段长度=%d  含 #modelConfigPanel=%s  含 settings-content=%s  含 settings-nav=%s  含 mc-list=%s'
              % (len(frag), 'modelConfigPanel' in frag, 'settings-content' in frag,
                 '"settings-nav"' in frag or "'settings-nav'" in frag or 'settings-nav ' in frag,
                 'mc-list' in frag))

print('')
print('=== B. 面板相关 background 规则（按 index 引入顺序） ===')
links = re.findall(r'<link[^>]+href="(css/[^"]+\.css)', idx)
SEL = re.compile(r'(?:^|[\s,>+~])(\.modal|\.settings-modal|\.settings-content|\.settings-nav|#modelConfigPanel|\.mc-wrap|\.mc-list|\.mc-item|\.mc-toolbar|\.mc-edit-panel)(?![\w-])')


def spec(sel):
    a = len(re.findall(r'#[\w-]+', sel))
    b = len(re.findall(r'\.[\w-]+|\[[^\]]+\]|:[:\w-]+', sel))
    c = len(re.findall(r'(?:^|[\s>+~])[a-z][\w-]*(?![\w-])', sel, re.I))
    return (a, b, c)


order = 0
rows = []
for l in links:
    fp = P('public', l.replace('/', os.sep))
    if not os.path.exists(fp):
        continue
    css = re.sub(r'/\*.*?\*/', ' ', rd(fp), flags=re.S)
    order += 1
    for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', css, re.S):
        sel = ' '.join(m.group(1).split())
        body = ' '.join(m.group(2).split())
        if 'background' not in body:
            continue
        if not SEL.search(sel):
            continue
        if re.search(r':hover|:focus|:active|:not\(|::|zf-style|settings-nav-(item|icon|header|badge|resize)', sel):
            continue
        bg = re.findall(r'background(?:-color)?\s*:\s*([^;]+)', body)
        imp = any('!important' in x for x in bg)
        rows.append((order, os.path.basename(l), sel, ' ; '.join(x.strip() for x in bg), imp, spec(sel)))

for r in sorted(rows, key=lambda x: (x[5], x[0])):
    print('  spec=%-12s imp=%-5s [%02d] %-28s %s  =>  %s' %
          (str(r[5]), r[4], r[0], r[2][:26], r[1], r[3][:90]))

print('')
print('=== C. 关键变量取值 ===')
base = rd(P('public', 'css', 'splits', 'split-01-base.css'))
for k, pat in [('--bg', r'--bg\s*:\s*([^;]+)'), ('--bg-card', r'--bg-card\s*:\s*([^;]+)'),
               ('--bg-hover', r'--bg-hover\s*:\s*([^;]+)'), ('--bg-input', r'--bg-input\s*:\s*([^;]+)'),
               ('--border-color', r'--border-color\s*:\s*([^;]+)')]:
    m = re.search(pat, base)
    print('  %-14s = %s' % (k, m.group(1).strip() if m else '未定义'))
ft = rd(P('public', 'css', 'style-filetree.css'))
for m in re.finditer(r'--bg-(primary|secondary)\s*:\s*([^;]+)', ft):
    print('  --bg-%-8s = %s' % (m.group(1), m.group(2).strip()))
print('  light 主题是否重定义 --bg-card :', 'YES' if re.search(r'\[data-theme="light"\][^{}]*\{[^{}]*--bg-card', base) else 'no')
print('  light 主题 .modal 背景          :', re.findall(r'\[data-theme="light"\] \.modal\{([^}]*)\}', base)[:2])
