import os, io
root = r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0'
skip = {'node_modules', '.git', 'zf-trash', '__pycache__'}
hits = []
kws = ['车道异常', '排队等待超时']
for dp, ds, fns in os.walk(root):
    ds[:] = [d for d in ds if d not in skip]
    for fn in fns:
        if fn.split('.')[-1] in ('py', 'js', 'json', 'mjs', 'ts'):
            p = os.path.join(dp, fn)
            try:
                t = open(p, encoding='utf-8', errors='ignore').read()
            except Exception:
                continue
            for kw in kws:
                if kw in t:
                    hits.append(p + '  [' + kw + ']')
with io.open(r'F:\朱峰社区智能体无限_新版本\朱峰社区智能体无限_5.7.0\_zf_scan_out.txt', 'w', encoding='utf-8') as f:
    f.write('\n'.join(hits) if hits else 'NO_MATCH')
