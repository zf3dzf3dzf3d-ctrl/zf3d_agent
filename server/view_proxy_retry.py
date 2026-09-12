import os, re

root = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2'
hits = []
for dirpath, dirnames, filenames in os.walk(root):
    dirnames[:] = [d for d in dirnames if d not in ('node_modules', '.git', 'python', '__pycache__')]
    for fn in filenames:
        if fn not in ('mixin_proxy.py', 'mixin_proxy_stream.py'):
            continue
        p = os.path.join(dirpath, fn)
        with open(p, 'r', encoding='utf-8-sig', errors='ignore') as f:
            content = f.read()
        print(f'===== {os.path.relpath(p, root)}  ({len(content)}字符) =====')
        # 打印重试相关行及上下文
        lines = content.split('\n')
        shown = set()
        for i, l in enumerate(lines):
            if re.search(r'重试|retry|502|10060|Remote end|EOF occurred|report\(|NetworkGuard|timeout', l, re.I):
                for j in range(max(0, i-2), min(len(lines), i+3)):
                    if j not in shown:
                        shown.add(j)
                        print(f'{j+1:5d}: {lines[j]}')
                print('  ...')
