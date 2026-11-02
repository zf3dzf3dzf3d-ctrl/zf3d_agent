# -*- coding: utf-8 -*-
import json, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
d = json.load(open(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.8.0\public\canvas\进化树\maps\_emergence.emergence.tree.json', encoding='utf-8'))
c = [0]
def w(n):
    c[0] += 1
    for x in n.get('children', []): w(x)
for r in d['roots']: w(r)
print('nodes =', c[0], '| today_only =', d['meta'].get('today_only'), '| exported_at =', d['meta'].get('exported_at'))
