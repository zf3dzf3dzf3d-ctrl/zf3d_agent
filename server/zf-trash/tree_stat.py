import json, os
base = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\public\canvas\进化树\maps'
def cnt(ns):
    t = 0
    for n in ns:
        t += 1 + cnt(n.get('children', []))
    return t
def walk(ns, nulls):
    for n in ns:
        if n.get('x') is None or n.get('y') is None:
            nulls[0] += 1
        walk(n.get('children', []), nulls)
for f in os.listdir(base):
    if f.endswith('.json') and 'eye' not in f:
        try:
            d = json.load(open(os.path.join(base, f), encoding='utf-8'))
        except Exception as e:
            print(f, 'PARSE FAIL', e); continue
        roots = d.get('roots', [])
        tot = cnt(roots)
        nulls = [0]
        walk(roots, nulls)
        print(f, '| total_nodes =', tot, '| null_xy =', nulls[0], '| created =', d.get('meta', {}).get('created'))
