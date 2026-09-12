with open(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.1.2\server\network_guard.py', 'r', encoding='utf-8-sig') as f:
    lines = f.read().split('\n')
print(f'总行数: {len(lines)}')
# 打印 40 行以后（前面 import 已看过）
for i, l in enumerate(lines):
    if i >= 25:
        print(f'{i+1:4d}: {l}')
