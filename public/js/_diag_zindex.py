"""诊断：项目面板/任务面板点击后 z-index 层叠与可见性检查
用 JS 模拟检查 CSS 规则冲突 —— 通过抓取页面 HTML+CSS 后静态分析
这里改为检查 css 中可能覆盖 .proj-panel / .task-panel 的规则
"""
import re, os

CSS_DIR = r'F:\朱峰社区智能体无限_新版本\新版本生产\朱峰社区智能体无限_5.0.0\public\css'
targets = ['proj-panel', 'task-panel', 'tp-fab-group', 'taskPanelBtn', 'chatStatusBtn']

# index.html 中 CSS 加载顺序
html = open(r'F:\朱峰社区智能体无限_新版本\新版本生产\朱峰社区智能体无限_5.0.0\public\index.html', encoding='utf-8').read()
order = re.findall(r'href="css/([^"?]+)', html)
print('CSS 加载顺序:')
for i, f in enumerate(order, 1):
    print(f'  {i}. {f}')

print()
print('=== 各 CSS 文件中对目标选择器的规则（按加载顺序，后面的覆盖前面的）===')
for f in order:
    p = os.path.join(CSS_DIR, f)
    if not os.path.exists(p):
        continue
    css = open(p, encoding='utf-8', errors='replace').read()
    # 找出所有规则块
    for m in re.finditer(r'([^{}]+)\{([^{}]+)\}', css):
        sel, body = m.group(1).strip(), m.group(2).strip()
        if any(t in sel for t in targets):
            # 只关心定位/显示相关
            if any(k in body for k in ['z-index', 'transform', 'display', 'visibility', 'opacity', 'position', 'left', 'right', 'width', 'overflow', 'pointer-events', 'inset', 'clip']):
                print(f'[{f}] {sel} {{ {body[:200]} }}')
