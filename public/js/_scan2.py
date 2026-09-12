import glob, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
root = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.2.0\public\js'
# 找出所有含“最小化”或 min 按钮/标题栏按钮区的 JS/HTML
pat = re.compile(r'最小化|btn-min|min-btn|cb-min|win-min|panel-min|app-min')
import re
for f in glob.glob(root + r'\**\*.*', recursive=True):
    if f.endswith(('.js', '.html', '.css')):
        try:
            s = open(f, encoding='utf-8', errors='ignore').read()
        except Exception:
            continue
        for m in pat.finditer(s):
            ln = s[:m.start()].count('\n') + 1
            line = s[s.rfind('\n', 0, m.start()) + 1:s.find('\n', m.end())]
            print(f.replace(root, ''), ln, line.strip()[:140])
